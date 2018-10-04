'use strict';

/**
 * Check for alarm recordings and send its metadata to Alexa Event Gateway.
 * 
 * Copyright (c) 2018 Lindo St. Angel.
 */

const fs = require('fs');
const util = require('util');
const https = require('https');
const uuidv4 = require('./node_modules/uuid/v4');
const { spawn } = require('child_process');
const sqlite3 = require('./node_modules/sqlite3').verbose();
const mongoClient = require('./node_modules/mongodb').MongoClient;

// Logger. 
const log = require('./logger');
console.log('Logger created...');

// Get general configuration.
const config = JSON.parse(fs.readFileSync('../config.json'));
// Get camera configuration.
const CAMERAS = config.cameras;
//
const RECORDINGS_BASE_PATH = config.recordings.recordingsBasePath;
//
const VIDEO_URI_BASE = config.recordings.videoUriBase;
// How often to check for recordings in ms.
const CHECK_RECORDINGS_INTERVAL = config.recordings.checkRecordingsInterval;
//
const CLIENT_ID = config.amzn.clientId;
//
const CLIENT_SECRET = config.amzn.clientSecret;
//
const GRANT_CODE = config.amzn.grantCode;
//
const LWA_HOST = config.amzn.lwaHost;
//
const LWA_PATH = config.amzn.lwaPath;
//
const EVENT_GATEWAY_HOST = config.amzn.eventGatewayHost;
//
const EVENT_GATEWAY_PATH = config.amzn.eventGatewayPath;
// Used to preemptively refresh access token if this time from expiry.
const PREEMPTIVE_REFRESH_TTL_IN_SECONDS = config.amzn.preemptiveRefreshTime;
// Query to get recording info from AXIS sqlite database.
const SQL = `SELECT recordings.id AS recordingId,
    recordings.filename AS recordingFileName,
    recordings.path AS recordingPath,
    blocks.filename AS blockFileName,
    blocks.path AS blockPath,
    recordings.starttime AS startTime,
    recordings.stoptime AS stopTime
    FROM recordings
    INNER JOIN blocks ON blocks.recording_id = recordings.id
    ORDER BY recordingId DESC LIMIT 3;`; // return last 3 records
//
const MONGODB_URL = config.mongodb.mongodbUrl;
//
const MONGODB_COLLECTION = config.mongodb.mongodbCollection;

/**
 * Post to an https endpoint.
 * 
 * @param {string} host
 * @param {string} path
 * @param {object} headers 
 * @param {string} postData 
 */
const httpsPost = (host, path, headers, postData) => {
    const options = {
        hostname: host,
        path: path,
        method: 'POST',
        headers: headers
    };

    return new Promise((resolve, reject) => {
        let data = '';

        const req = https.request(options, result => {
            result.on('data', (chunk) => {
                data += chunk;
            });

            result.on('end', () => {
                const response = {
                    'status': result.statusCode,
                    'headers': result.headers,
                    'data': data
                };

                // status = 202 -> LWA success; status = 200 -> auth refresh success
                if ((result.statusCode === 202) || (result.statusCode === 200)) {
                    resolve(response);
                } else {
                    reject(response);
                }
            });
        });

        req.write(postData);

        req.end();

        req.on('error', err => {
            reject(err.stack);
        });
    });
};

/**
 * Store auth token as JSON.
 * 
 * @param {string} token
 * 
 * @returns {Promise} - Access token.
 */
const storeToken = token => {
    const tokenObj = JSON.parse(token);

    const data = {
        'accessToken': tokenObj.access_token,
        'refreshToken': tokenObj.refresh_token,
        'expiresIn': tokenObj.expires_in,
        'datetime': (new Date()).toISOString()
    };

    return new Promise((resolve, reject) => {
        fs.writeFile('./tokens.json', JSON.stringify(data, null, 2), 'utf8', (err) => {
            err ? reject(err) : resolve(tokenObj.access_token);
        });
    });
};

/**
 * Write contents to a file as JSON.
 * 
 * @param {string} fileName 
 * @param {string} json 
 * 
 * @returns {Promise}
 */
const storeJSON = (fileName, json) => {
    return new Promise((resolve, reject) => {
        fs.writeFile(fileName, JSON.stringify(json, null, 2), 'utf8', (err) => {
            err ? reject(err) : resolve('stored json');
        });
    });
};

/**
 * Checks if access token is missing or needed to be refreshed.
 */
const checkAccessToken = () => {
    const checkAccessTokenResponse = {
        'needNewToken': false,
        'accessToken': null,
        'refreshToken': null
    };

    const tokens = JSON.parse(fs.readFileSync('./tokens.json'));
    
    if (tokens.accessToken != null) {
        // We've already gotten the first access token for this user's skill enablement.
        const tokenReceivedDatetime = Date.parse(tokens.datetime);
        const tokenExpiresIn = tokens.expiresIn - PREEMPTIVE_REFRESH_TTL_IN_SECONDS;
        const accessToken = tokens.accessToken;
        const refreshToken = tokens.refreshToken;
        const tokenExpiresDatetime = tokenReceivedDatetime + (tokenExpiresIn * 1000);
        const currentDatetime = Date.now();

        checkAccessTokenResponse.needNewToken = currentDatetime > tokenExpiresDatetime;
        checkAccessTokenResponse.accessToken = accessToken;
        checkAccessTokenResponse.refreshToken = refreshToken;
    } else {
        // We've never gotten an access token for this user's skill enablement.
        checkAccessTokenResponse.needNewToken = true;
    }

    return checkAccessTokenResponse;
};

/**
 * Performs access token or token refresh request as needed.
 * Returns a promise to a valid access token.
 * 
 * @returns {Promise}
 */
const getAccessToken = () => {
    const checkAccessTokenResponse = checkAccessToken();

    return new Promise((resolve, reject) => {
        if (checkAccessTokenResponse.needNewToken) {
            let postData = '';
            if (checkAccessTokenResponse.accessToken != null) {
                // Access token already exists, so this should be a token refresh request.
                postData = 'grant_type=refresh_token&refresh_token='+checkAccessTokenResponse.refreshToken+
                    '&client_id='+CLIENT_ID+'&client_secret='+CLIENT_SECRET;

                log.info('Calling LWA to refresh the access token...');
            } else {
                // Access token not retrieved yet, so this should be an access token request.
                postData = 'grant_type=authorization_code&code='+GRANT_CODE+
                    '&client_id='+CLIENT_ID+'&client_secret='+CLIENT_SECRET;

                log.debug(postData);

                log.info('Calling LWA to get the access token for the first time..');
            }

            const lwaHeaders = {
                'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
            };

            httpsPost(LWA_HOST, LWA_PATH, lwaHeaders, postData).then(res => {
                return storeToken(res.data);
            }).then(res => {
                resolve(res);
            }).catch(err => {
                reject(err);
            });

        } else {
            log.info('Latest access token has not expired, so using it and won\'t call LWA...');

            resolve(checkAccessTokenResponse.accessToken);
        }
    });
};

/**
 * Convert a .mkv file to a .mp4 file.
 * 
 * @param {string} mkvFile 
 * @param {string} mp4File
 * 
 * @returns {Promise}
 */
const convertMkvToMp4 = (mkvFile, mp4File) => {
    return new Promise((resolve, reject) => {
        const cmd = '/usr/bin/ffmpeg';
        // ffmpeg outputs all of its logging data to stderr.
        // Therefore set loglevel to 'error' to show only true errors.
        const args = ['-hide_banner',
            '-loglevel', 'error',
            '-i', `${mkvFile}`,
            '-codec', 'copy',
            `${mp4File}`];
        const child = spawn(cmd, args);
        let stderrData = '';
        let stdoutData = '';
        
        child.stderr.on('data', chunk => {
            stderrData += chunk;
        });

        child.stdout.on('data', chunk => {
            stdoutData += chunk;
        });

        child.on('error', err => {
            reject(`convertMkvToMp4 error. error: ${err}`); 
        });

        child.on('exit', (code, signal) => {
            log.debug(`convertMkvToMp4 exit code: ${code}`);
            log.debug(`convertMkvToMp4 signal: ${signal}`);
            if (stderrData) {
                log.debug(`convertMkvToMp4 stderr: ${stderrData}`);
                reject('No recording found.');
            } else if (stdoutData) {
                log.debug(`convertMkvToMp4 stdout: ${stdoutData}`);
                resolve('Recording found.');
            } else {
                resolve('Recording found.');
            }
        });
    });
};

/**
 * Delete a file.
 * 
 * @param {string} file - The file to be deleted.
 * 
 * @returns {Promise}
 */
const deleteFile = file => {
    return new Promise((resolve, reject) => {
        fs.unlink(file, err => {
            err ? reject(`deleteFile error: ${err}`) : resolve('File deleted.');
        });
    });
};

/**
 * Connect to a mongoDb database. Return promise to client object.
 * 
 * @param {string} url
 * 
 * @returns {Promise}
 */
const openMongodb = url => {
    return new Promise((resolve, reject) => {
        mongoClient.connect(url, (err, client) => {
            err ? reject(`openMongodb error: ${err}`) : resolve(client);
        });
    });
};

/**
 * 
 * Insert a document into a mongodb collection. Return promise to result.
 * 
 * @param {object} client 
 * @param {string} collectionName 
 * @param {object} document 
 * 
 * @return {Promise}
 */
const insertDocMongodb = (client, collectionName, document) => {
    const collection = client.db().collection(collectionName);
    return new Promise ((resolve, reject) => {
        collection.insertOne(document, (err, res) => {
            err ? reject(`insertDocMongodb error: ${err}`) : resolve(res);
        });
    });
};

/**
 * 
 * Check if a document exists in a mongodb collection.
 * 
 * @param {object} client 
 * @param {string} collectionName 
 * @param {object} document 
 * 
 * @return {Promise}
 */
const checkIfMongodbDocExists = (client, collectionName, document) => {
    const collection = client.db().collection(collectionName);
    return new Promise ((resolve, reject) => {
        collection.findOne(document, (err, res) => {
            err ? reject(`checkIfMongodbDocExists error: ${err}`) : resolve(res !== null);
        });
    });
};

/**
 * Main function to check for new recordings.
 * Much of this code is specific to AXIS cameras.
 * AXIS cameras store recordings as .mkv files and use a sqlite db to track. 
 */
const checkForNewRecordings = () => {
    CAMERAS.forEach(camera => {
        log.info(`Checking for new recordings on camera ${camera.friendlyName}.`);

        // Form filesystem path to camera recording database and open it.
        const cameraDbPath = RECORDINGS_BASE_PATH+camera.manufacturerId+'/index.db';
        if (!fs.existsSync(cameraDbPath)) {
            log.error('Camera database not found.');
            return;
        }
        const db = new sqlite3.Database(cameraDbPath);

        db.all(SQL, (err, rows) => {
            if (err) {
                log.error(`Database error: ${err.message}`);
                return;
            }

            if (Object.keys(rows).length === 0 && rows.constructor === Object) {
                log.debug('No database records found.');
                return;
            }
			
            const numOfRecordings = rows.length;			
            let recordingsUploaded = 0;

            // Each row is a recording.
            // Using forEach to create closure so processing will proceed in parallel.
            rows.forEach(row => {
                log.debug(`db row: ${row.recordingId} ${row.recordingFileName} ${row.recordingPath}
                    ${row.blockFileName} ${row.blockPath} ${row.startTime} ${row.stopTime}`);

                // If stopTime is null a recording is in progress, so skip.
                if (row.stopTime === null) {
                    log.info('Recording in progress.');
                    return;
                }
            
                // Form paths to actual recordings.
                // Axis records in mkv container. This will be converted to mp4 later on for Alexa.
                const baseRecordingPath = RECORDINGS_BASE_PATH+camera.manufacturerId+'/'+row.recordingPath+
                    '/'+row.recordingFileName+'/'+row.blockPath+'/';
                const mkvName = baseRecordingPath+row.blockFileName+'.mkv';
                const mp4Name = baseRecordingPath+row.blockFileName+'.mp4';
                log.debug(`mkvName: ${mkvName}`);
                log.debug(`mp4Name: ${mp4Name}`);

                // Format media id for Alexa MediaMetadata API.
                // Must be less than 256 characters.
                // Must contain letters, numbers or underscore only.
                const pathArr = row.recordingPath.split('/');
                const manufacturerIdArr = camera.manufacturerId.split('-');
                const mediaId = manufacturerIdArr[0]+'__'+manufacturerIdArr[1]+'__'+pathArr[0]+'__'
                    +pathArr[1]+'__'+row.recordingFileName+'__'+row.blockPath+'__'+row.blockFileName;

                let mongodbClient = {};
                let accessToken = '';
                let postData = '';

                // General flow of promise chain is:
                //     Check if recording was already uploaded;
                //     Convert .mkv to .mp4;
                //     Get access token to Alexa Event Gateway;
                //     Post recording metadata to Gateway;
                //     Mark recording as uploaded in mongodb database.
                //
                // NB: It would have been cleaner to add an upload record to the AXIS sqlite db
                //     instead of using a separate mongodb database.
                //     But I could not get that to work. Looks like AXIS guards against mods to the db.
                openMongodb(MONGODB_URL).then(res => {
                    mongodbClient = res;
                    const doc = {'recordingPath': baseRecordingPath};
                    return checkIfMongodbDocExists(mongodbClient, MONGODB_COLLECTION, doc);
                }).then(res => {
                    log.debug(`checkIfMongodbDocExists result: ${res}`);
                    if (res) {
                        mongodbClient.close();
                        return Promise.reject('Recording exists.'); // TODO - seems like a hack.
                    } else {
                        return convertMkvToMp4(mkvName, mp4Name);
                    }
                }).then(res => {
                    log.debug(`convertMkvToMp4 result: ${res}`);
                    return deleteFile(mkvName);
                }).then(res => {
                    log.debug(`deleteFile result: ${res}`);
                    return getAccessToken();
                }).then(res => {
                    accessToken = res;
                    const msgID = uuidv4();

                    let tenMinsFromNow = new Date();
                    tenMinsFromNow.setMinutes(tenMinsFromNow.getMinutes() + 10);
    
                    const videoUri = VIDEO_URI_BASE+mp4Name;
                    log.debug(`videoUri: ${videoUri}`);
    
                    postData = {
                        'event': {
                            'header': {
                                'namespace': 'Alexa.MediaMetadata',
                                'name': 'MediaCreatedOrUpdated',
                                'messageId': msgID,
                                'payloadVersion': '3'
                            },
                            'endpoint': {
                                'scope': {
                                    'type': 'BearerToken',
                                    'token': accessToken
                                },
                                'endpointId': camera.endpointId
                            },
                            'payload': {
                                'media': {
                                    'id': mediaId,
                                    'cause': 'MOTION_DETECTED',
                                    'recording': {
                                        'name': camera.friendlyName,
                                        'startTime': row.startTime.split('.')[0]+'Z',
                                        'endTime': row.stopTime.split('.')[0]+'Z',
                                        'videoCodec': 'H264',
                                        'audioCodec': 'NONE',
                                        'uri': {
                                            'value': videoUri,
                                            'expireTime': tenMinsFromNow.toISOString().split('.')[0]+'Z'
                                        }
                                    }
                                }
                            }
                        }
                    };
    
                    log.debug(`post data: ${util.inspect(postData, {showHidden: false, depth: null})}`);
    
                    // Store payload for potential use later. 
                    const jsonPath = RECORDINGS_BASE_PATH+camera.manufacturerId+'/'+row.recordingPath+'/'+
                        row.recordingFileName+'/'+row.blockPath+'/payload.json';
                    return storeJSON(jsonPath, postData.event.payload);
                }).then(res => {
                    log.debug(`storeJSON result: ${res}`);
    
                    const alexaHeaders = {
                        'Authorization': 'Bearer ' + accessToken,
                        'Content-Type': 'application/json;charset=UTF-8'
                    };
    
                    return httpsPost(EVENT_GATEWAY_HOST, EVENT_GATEWAY_PATH, alexaHeaders, JSON.stringify(postData));
                }).then(res => {
                    log.info(`Posted ${mediaId} to Alexa Event Gateway.`);
                    log.debug(`Gateway POST result: ${util.inspect(res, {showHidden: false, depth: null})}`);

                    const uploadTimeStamp = new Date();
                    const mongodbDoc = {
                        'recordingId': row.recordingId,
                        'recordingStartTime': row.startTime,
                        'recordingStopTime': row.stopTime,
                        'recordingPath': baseRecordingPath,
                        'recordingUploadTime': uploadTimeStamp.toISOString()
                    };
                    return insertDocMongodb(mongodbClient, MONGODB_COLLECTION, mongodbDoc);
                }).then(res => {
                    log.debug(res);
                    mongodbClient.close();
                    recordingsUploaded++;
                    if (recordingsUploaded > numOfRecordings) db.close();
                }).catch(err => {
                    if (err === 'Recording exists.') log.debug(err);
                    else log.error(`Gateway POST error: ${util.inspect(err, {showHidden: false, depth: null})}`);
                });
            });
        });
    });
};

// Start checking for new recordings. 
setInterval(checkForNewRecordings, CHECK_RECORDINGS_INTERVAL);