'use strict';

/**
 * Watch for alarm video clips and send its metadata to Alexa Event Gateway.
 * 
 * Copyright (c) 2018 Lindo St. Angel.
 */

//const chokidar = require('chokidar');
const fs = require('fs');
//const fsPath = require('path');
const parseString = require('xml2js').parseString;
const util = require('util');
const https = require('https');
const uuidv4 = require('./node_modules/uuid/v4');
const { spawn } = require('child_process');
const sqlite3 = require('./node_modules/sqlite3').verbose();

// Logger. 
const log = require('./logger');
console.log('Logger created...');

// Get general configuration.
const config = JSON.parse(fs.readFileSync('./config.json'));
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

/**
 * 
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
 * 
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
 * 
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
 * Returns valid access token
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

                console.log(postData);

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

const parseStringPromise = input => {
    return new Promise((resolve, reject) => {
        parseString(input, (err, res) => {
            err ? reject(err) : resolve(res);
        });
    });
};

const readFilePromise = input => {
    return new Promise((resolve, reject) => {
        fs.readFile(input, 'utf8', (err, res) => {
            err ? reject(err) : resolve(res);
        });
    });
};

const renameFile = (oldName, newName) => {
    return new Promise((resolve, reject) => {
        fs.rename(oldName, newName, err => {
            err ? reject(err) : resolve('renamed file');
        });
    });
};

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
 * 
 * Ref: https://superuser.com/questions/100288/how-can-i-check-the-integrity-of-a-video-file-avi-mpeg-mp4
 * 
 * @param {string} videoFile - Video input file to be validated.
 */
const checkVideoValidity = videoFile => {
    return new Promise((resolve, reject) => {
        const cmd = '/usr/bin/ffmpeg';
        const args = ['-hide_banner',
            '-loglevel', 'error',
            '-i', `${videoFile}`,
            '-f', 'null',
            '-'];
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
            reject(`checkVideoValidity error. error: ${err}`); 
        });

        child.on('exit', (code, signal) => {
            log.debug(`checkVideoValidity exit code: ${code}`);
            log.debug(`checkVideoValidity signal: ${signal}`);
            if (stderrData) {
                log.debug(`checkVideoValidity stderr: ${stderrData}`);
                reject('No recording found.');
            } else {
                log.debug(`checkVideoValidity stdout: ${stdoutData}`);
                resolve('Recording found.');
            }
        });
    });
};

/**
 * 
 * Ref: https://superuser.com/questions/650291/how-to-get-video-duration-in-seconds
 * 
 * @param {float} duration - Expected duration of recording in seconds.
 * @param {string} recording - Full filesystem path to recording. 
 */
const checkIfRecordingIsDone = (duration, recording) => {
    const cmd = '/usr/bin/ffprobe';
    const args = ['-loglevel', 'error',
        '-show_entries',
        'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        `${recording}`];
    return new Promise((resolve, reject) => {
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
            reject(`checkIfRecordingIsDone error. error: ${err}`); 
        });

        child.on('exit', (code, signal) => {
            log.debug(`checkIfRecordingIsDone exit code: ${code}`);
            log.debug(`checkIfRecordingIsDone signal: ${signal}`);
            if (stderrData) {
                log.debug(`checkIfRecordingIsDone stderr: ${stderrData}`);
                reject('No recording found.');
            } else {
                log.debug(`checkIfRecordingIsDone stdout: ${stdoutData}`);
                const actualDuration = parseFloat(stdoutData);
                (actualDuration >= duration) ? resolve('Recording found.') : reject('No recording found.');
            }
        });
    });
};

// returns a promise which resolves true if file exists:
const checkFileExists = filePath => {
    return new Promise((resolve, reject) => {
        fs.access(filePath, fs.F_OK, error => {
            resolve(!error);
        });
    });
};

/**
 * 
 * @param {string} file - The file to be deleted. 
 */
const deleteFile = file => {
    return new Promise((resolve, reject) => {
        fs.unlink(file, err => {
            err ? reject(`deleteFile error: ${err}`) : resolve('File deleted.');
        });
    });
};

let currentRecordingId = 0;

const checkForNewRecordings = () => {
    log.info('Checking for new recordings.');
    const db = new sqlite3.Database('/nvr/camera-share/axis-ACCC8E5E7513/index.db');

    db.serialize(() => {
        const sql = `SELECT recordings.id AS recordingId,
                        recordings.filename AS recordingFileName,
                        recordings.path AS recordingPath,
                        blocks.filename AS blockFileName,
                        blocks.path AS blockPath,
                        recordings.starttime AS startTime,
                        recordings.stoptime AS stopTime
                    FROM recordings
                    INNER JOIN blocks ON blocks.recording_id = recordings.id
                    ORDER BY recordingId DESC LIMIT 1;`;
        db.each(sql, (err, row) => {
            if (err) {
                log.error(err.message);
            }

            log.debug(`db rows: ${row.recordingId} ${row.recordingFileName} ${row.recordingPath}
                ${row.blockFileName} ${row.blockPath} ${row.startTime} ${row.stopTime}`);

            if (row.recordingId > currentRecordingId && row.stopTime !== null) {
                log.info('Found new recording.');
                currentRecordingId = row.recordingId;
                const mkvName = '/nvr/camera-share/axis-ACCC8E5E7513/'+row.recordingPath+
                    '/'+row.recordingFileName+'/'+row.blockPath+'/'+row.blockFileName+'.mkv';
                const mp4Name = '/nvr/camera-share/axis-ACCC8E5E7513/'+row.recordingPath+
                    '/'+row.recordingFileName+'/'+row.blockPath+'/'+row.blockFileName+'.mp4';
                log.debug(`mkvName: ${mkvName}`);
                log.debug(`mp4Name: ${mp4Name}`);

                let accessToken = '';
                let postData = '';
                const pathArr = row.recordingPath.split('/');
                const mediaId = pathArr[0]+'__'+pathArr[1]+'__'+row.recordingFileName+
                    '__'+row.blockPath+'__'+row.blockFileName;
                convertMkvToMp4(mkvName, mp4Name).then(res => {
                    log.debug(`convertMkvToMp4 result: ${res}`);
                    return deleteFile(mkvName);
                }).then(res => {
                    log.debug(`deleteFile result: ${res}`);
                    return getAccessToken();
                }).then(res => {
                    accessToken = res;
                    const msgID = uuidv4();
                    // Get time ten minutes from now.
                    let tenMinsFromNow = new Date();
                    tenMinsFromNow.setMinutes(tenMinsFromNow.getMinutes() + 10);
    
                    const videoUri = 'https://cam.lsacam.com:9443' + mp4Name;
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
                                'endpointId': '1'
                            },
                            'payload': {
                                'media': {
                                    'id': mediaId,
                                    'cause': 'MOTION_DETECTED',
                                    'recording': {
                                        'name': 'Front Porch Camera',
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
    
                    const jsonPath = '/nvr/camera-share/axis-ACCC8E5E7513/'+row.recordingPath+'/'+row.recordingFileName+'/'+row.blockPath+'/payload.json';
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
                }).catch(err => {
                    if (err === 'No recording found.') log.debug(err);
                    else log.error(`Gateway POST error: ${util.inspect(err, {showHidden: false, depth: null})}`);
                });
            }
        });
        db.close();
    });
};
  
setInterval(checkForNewRecordings, 2000);

// Initialize watcher.
/*const watcher = chokidar.watch('/nvr/camera-share', {
    ignored: /(^|[\/\\])\../,
    persistent: true
});*/

// Add event listeners.
/*watcher
    .on('error', error => log.error(`Watcher error: ${error}`))
    .on('add', path => {
        log.debug(`File ${path} has been added.`);
    })
    .on('change', path => {
        log.debug(`File ${path} has been changed.`);

        const extName = fsPath.extname(path);

        if (path === '/nvr/camera-share/axis-ACCC8E5E7513/index.db') {
            /*let db = new sqlite3.Database('/nvr/camera-share/axis-ACCC8E5E7513/index.db');

            db.serialize(() => {
                db.each('SELECT id FROM recordings', (err, row) => {
                    if (err) {
                        console.error(err.message);
                    }
                    console.log(row.id);
                });
                db.close();
            });*/

            //db.close();

            /*db.each('SELECT id as recordingId FROM recordings', (err, row) => {
                if (err) {
                    console.log(err.message);
                }
                console.log(row.recordingId);
            });*/

            /*
            // Form path to Recording xml file.
            //const arr = path.split('/');
            //console.log(`arr: ${arr}`);
            //const spl = arr.pop();
            //console.log(`spl: ${spl}`);
            //const result = arr.join('/');
            //console.log(`result: ${result}`);
            const recordingXmlPathArr = path.split('/');
            recordingXmlPathArr.pop();
            recordingXmlPathArr.pop();
            const recordingXmlPath = recordingXmlPathArr.join('/');
            log.debug(`recordingXmlPath: ${recordingXmlPath}.`);

            const dirName = fsPath.dirname(path);
            log.info(`dirName: ${dirName}`);

            const baseName = fsPath.basename(path);
            log.info(`baseName: ${baseName}`);

            const videoName = baseName.split('.')[0] + '.mp4';
            log.info(`videoName: ${videoName}`);

            const mp4File = dirName+'/'+videoName;

            const mkvName = dirName + '/' + baseName.split('.')[0] + '.mkv';
            log.info(`mkvName: ${mkvName}`);

            let mediaId = '';
            let startTime = '';
            let stopTime = '';
            let accessToken = '';
            let postData = {};

            readFilePromise(path).then(res => {
                return parseStringPromise(res);
            }).then(res => {
                log.debug(`xml parse res: ${util.inspect(res, {showHidden: false, depth: null})}`);

                if ('RecordingBlock' in res && res.RecordingBlock.Status[0] === 'Complete') {
                    mediaId = res.RecordingBlock.RecordingToken[0];
                    // Remove msecs from datetimes.
                    startTime = res.RecordingBlock.StartTime[0].split('.')[0]+'Z';
                    stopTime = res.RecordingBlock.StopTime[0].split('.')[0]+'Z';
                    // Calculate recording duration. 
                    const startSexagesimal = res.RecordingBlock.StartTime[0].split('T');
                    log.debug(`startSexagesimal: ${startSexagesimal}`);
                    const startMins = startSexagesimal[1].split(':')[1];
                    const startSecs = startSexagesimal[1].split(':')[2].split('.')[0];
                    const startMSec = startSexagesimal[1].split(':')[2].split('.')[1];
                    const start = parseFloat(startMins * 60 + startSecs + startMSec);
                    log.debug(`start: ${start}`);
                    const stopSexagesimal = res.RecordingBlock.StopTime[0].split('T');
                    const stopMins = stopSexagesimal[1].split(':')[1];
                    const stopSecs = stopSexagesimal[1].split(':')[2].split('.')[0];
                    const stopMSec = stopSexagesimal[1].split(':')[2].split('.')[1];
                    const stop = parseFloat(stopMins * 60 + stopSecs + stopMSec);
                    log.debug(`stop: ${stop}`);
                    const duration = stop - start;
                    log.debug(`duration: ${duration}`);
                    //return getAccessToken();
                    return checkIfRecordingIsDone(duration, mkvName);
                } else {
                    // TODO: Using reject to exit the chain early - there's probably a cleaner way.
                    return Promise.reject('No recording found.');
                }
            }).then(res => {
                log.debug(`checkIfRecordingIsDone result: ${res}`);
                return convertMkvToMp4(mkvName, mp4File);
            }).then(res => {
                log.debug(`convertMkvToMp4 result: ${res}`);
                return getAccessToken();
            }).then(res => {
                accessToken = res;
                const msgID = uuidv4();
                // Get time ten minutes from now.
                let tenMinsFromNow = new Date();
                tenMinsFromNow.setMinutes(tenMinsFromNow.getMinutes() + 10);

                const videoUri = 'https://cam.lsacam.com:9443' + dirName + '/' + videoName;
                log.info(`videoUri: ${videoUri}`);

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
                            'endpointId': '1'
                        },
                        'payload': {
                            'media': {
                                'id': mediaId,
                                'cause': 'MOTION_DETECTED',
                                'recording': {
                                    'name': 'Front Porch Camera',
                                    'startTime': startTime,
                                    'endTime': stopTime,
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

                return storeJSON(dirName + '/payload.json', postData.event.payload);
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
            }).catch(err => {
                if (err === 'No recording found.') log.debug(err);
                else log.error(`Gateway POST error: ${util.inspect(err, {showHidden: false, depth: null})}`);
            });
        }
    })
    .on('unlink', path => {
        log.debug(`File ${path} has been removed`);
    });*/