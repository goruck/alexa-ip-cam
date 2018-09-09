'use strict';

/**
 * Watch for alarm video clips and send its metadata to Alexa Event Gateway.
 * 
 * Copyright (c) 2018 Lindo St. Angel.
 */

const chokidar = require('chokidar');
const fs = require('fs');
const fsPath = require('path');
const parseString = require('xml2js').parseString;
const util = require('util');
const https = require('https');
const uuidv4 = require('./node_modules/uuid/v4');

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

// Initialize watcher.
const watcher = chokidar.watch('/nvr/camera-share', {
    ignored: /(^|[\/\\])\../,
    persistent: true
});

// Add event listeners.
watcher
    .on('error', error => log(`Watcher error: ${error}`))
    .on('add', path => {
        log.debug(`File ${path} has been added`);
    })
    .on('change', path => {
        log.debug(`File ${path} has been changed`);

        const extName = fsPath.extname(path);
        //const dirName = fsPath.dirname(path);

        if (extName === '.xml') {
            let mediaId = '';
            let startTime = '';
            let stopTime = '';
            readFilePromise(path).then(res => {
                return parseStringPromise(res);
            }).then(res => {
                log.debug(`xml parse res: ${util.inspect(res, {showHidden: false, depth: null})}`);

                // Check for recording from camera.
                if (res.hasOwnProperty('RecordingBlock') && (res.RecordingBlock.Status[0] === 'Complete')) {
                    //
                    mediaId = res.RecordingBlock.RecordingToken[0];
                    // Remove msecs from datetimes.
                    startTime = res.RecordingBlock.StartTime[0].split('.')[0]+'Z';
                    stopTime = res.RecordingBlock.StopTime[0].split('.')[0]+'Z';
                
                    return getAccessToken();
                } else {
                    // TODO: Using reject to exit the chain early - there's probably a cleaner way.
                    return Promise.reject('No recording found.');
                }
            }).then(res => {
                const accessToken = res;
                const msgID = uuidv4();
                // Get time ten minutes from now.
                let tenMinsFromNow = new Date();
                tenMinsFromNow.setMinutes(tenMinsFromNow.getMinutes() + 10);

                const postData = {
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
                                        'value': 'https://lindo.loginto.me:60945/public/alarm-video.mp4',
                                        //'value': 'https://s3-us-west-2.amazonaws.com/alexa-ip-cam-test/alarm-video.mp4',
                                        'expireTime': tenMinsFromNow.toISOString().split('.')[0]+'Z'
                                    },
                                    'thumbnailUri': {
                                        'value': 'https://78.media.tumblr.com/70e7a471dec5e0c3e6807242bf838fd0/tumblr_muj26tUeaP1qj3dtso1_500.png',
                                        'expireTime': tenMinsFromNow.toISOString().split('.')[0]+'Z'
                                    }
                                }
                            }
                        }
                    }
                };

                log.debug(`post data: ${util.inspect(postData, {showHidden: false, depth: null})}`);

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
    });