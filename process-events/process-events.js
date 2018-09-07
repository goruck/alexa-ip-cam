'use strict';

const chokidar = require('chokidar');
const fs = require('fs');
const fsPath = require('path');
const parseString = require('xml2js').parseString;
const util = require('util');
const https = require('https');
const uuidv4 = require('./node_modules/uuid/v4');

// Simple logger.
//const log = console.log.bind(console);

// Logger. 
const log = require('./logger');
console.log('Logger created...');

// Get general configuration.
const config = JSON.parse(fs.readFileSync('./config.json'));
//
const LWA_HOST = config.amzn.lwaHost;
//
const LWA_PATH = config.amzn.lwaPath;
//
const ALEXA_HOST = config.amzn.alexaHost;
//
const ALEXA_PATH = config.amzn.alexaPath;
// Used to preemptively refresh access token if 5 mins from expiry.
const PREEMPTIVE_REFRESH_TTL_IN_SECONDS = 300;

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
    //log(`token...${util.inspect(tokenObj, {showHidden: false, depth: null})}`);
    const data = {
        'accessToken': tokenObj.access_token,
        'refreshToken': tokenObj.refresh_token,
        'expiresIn': tokenObj.expires_in,
        'datetime': (new Date()).toISOString()
    };

    // todo: change to append.

    return new Promise((resolve, reject) => {
        fs.writeFile('./tokens.json', JSON.stringify(data), 'utf8', (err) => {
            (err) ? reject(err) : resolve(tokenObj.access_token);
        });
    });
};

/**
 * Checks if access token is missing or needed to be refreshed.
 */
const checkAccessToken = () => {
    const checkAccessTokenResponse = {
        'needNewToken': false,
        'accessToken': '',
        'refreshToken': ''
    };

    const tokens = JSON.parse(fs.readFileSync('./tokens.json'));
    //log(`tokens: ${util.inspect(tokens, {showHidden: false, depth: null})}`);
    
    if (typeof(tokens.accessToken) !== undefined) {
        // Token exists we've already gotten the first access token for this user's skill enablement.
        const tokenReceivedDatetime = new Date(tokens.datetime);
        //log(tokenReceivedDatetime);
        const tokenExpiresIn = tokens.expiresIn - PREEMPTIVE_REFRESH_TTL_IN_SECONDS;
        const accessToken = tokens.accessToken;
        const refreshToken = tokens.refreshToken;
        const tokenExpiresDatetime = tokenReceivedDatetime.setSeconds(
            tokenReceivedDatetime.getSeconds() + tokenExpiresIn);
        //log(tokenExpiresDatetime);
        const currentDatetime = new Date();
        //log(currentDatetime);

        //checkAccessTokenResponse.needNewToken = currentDatetime > tokenExpiresDatetime;
        checkAccessTokenResponse.needNewToken = true;
        checkAccessTokenResponse.accessToken = accessToken;
        checkAccessTokenResponse.refreshToken = refreshToken;
    } else {
        // Never gotten an access token for this user's skill enablement.
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

    //log(`checkAccessTokenResponse: ${util.inspect(checkAccessTokenResponse, {showHidden: false, depth: null})}`);

    return new Promise((resolve, reject) => {
        if (checkAccessTokenResponse.needNewToken) {
            let postData = '';
            if (typeof(checkAccessTokenResponse.accessToken) !== undefined) {
                // Access token already exists, so this should be a token refresh request.
                postData = 'grant_type=refresh_token&refresh_token='+checkAccessTokenResponse.refreshToken+
                    '&client_id='+config.amzn.clientId+'&client_secret='+config.amzn.clientSecret;

                log.info('Calling LWA to refresh the access token...');
            } else {
                // Access token not retrieved yet, so this should be an access token request.
                postData = 'grant_type=authorization_code&code='+config.code+
                    '&client_id='+config.amzn.clientId+'&client_secret='+config.amzn.clientSecret;

                log.info('Calling LWA to get the access token for the first time..');
            }

            const lwaHeaders = {
                'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
            };

            httpsPost(LWA_HOST, LWA_PATH, lwaHeaders, postData).then(res => {
                //log(`res...${util.inspect(res, {showHidden: false, depth: null})}`);
                return storeToken(res.data);
            }).then(res => {
                //log(`res: ${res}`);
                resolve(res);
            }).catch(err => {
                reject(err);
            });

        } else {
            log.info('Latest access token has not expired, so using it and won\'t call LWA...');

            //log(`access token: ${checkAccessTokenResponse.accessToken}`);
            resolve(checkAccessTokenResponse.accessToken);
        }
    });
};

/**
 * 
 */
const convertDatetime = datetime => {
    // 2018-09-02T22:27:47.422743Z

    // Get microseconds.
    // Split at '.', take usecs and drop end 'Z'.
    const dtArr = datetime.split('.');
    const usec = parseInt(dtArr[1].slice(0, -1));

    // Convert usecs to msecs.
    let msecs = (usec / 1000).toFixed(0);
    if (parseInt(msecs) < 10) {
        msecs = '00' + msecs;
    } else if (parseInt(msecs) < 100) {
        msecs = '0' + msecs;
    }

    // Assemble back datetime and return.
    return (dtArr[0] + '.' + msecs + 'Z');
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
        //log(`File ${path} has been added`);
    })
    .on('change', path => {
        //log(`File ${path} has been changed`);

        const extName = fsPath.extname(path);
        const dirName = fsPath.dirname(path);

        if (extName === '.xml') {
            fs.readFile(path, (err, res) => {
                if (err) log.error(`err: ${err}`);

                parseString(res, (err, res) => {
                    if (err) log.error(`err: ${err}`);

                    //log(`xml parse res: ${util.inspect(res, {showHidden: false, depth: null})}`);

                    /*
                    { RecordingBlock: 
                        { '$': { RecordingBlockToken: '20180902_052137_FB2B' },
                          RecordingToken: [ '20180902_052137_7A60_ACCC8E5E7513' ],
                          StartTime: [ '2018-09-02T12:21:37.154103Z' ],
                          StopTime: [ '2018-09-02T12:21:46.787262Z' ],
                          Status: [ 'Complete' ] } }
                    */

                    // Find and store video metadata.
                    if (res.hasOwnProperty('RecordingBlock')) {
                        if (res.RecordingBlock.Status[0] === 'Complete') {
                            const recordingBlockToken = res.RecordingBlock.$.RecordingBlockToken;
                            const fileName = dirName + '/' + recordingBlockToken + '.mkv';
                            const startTime = res.RecordingBlock.StartTime[0];
                            const stopTime = res.RecordingBlock.StopTime[0];

                            //log(`fileName: ${fileName}`);
                            //log(`startTime: ${startTime}`);
                            const startTimeMs = convertDatetime(startTime);
                            //log(`startTimeMS: ${startTimeMs}`);
                            //log(`stopTime: ${stopTime}`);
                            const stopTimeMs = convertDatetime(stopTime);
                            //log(`stopTimeMs: ${stopTimeMs}`);

                            const msgID = uuidv4();
                            //log(`msgID: ${msgID}`);

                            // Get current time.
                            const currentTime = new Date();
                            // Get time ten minutes from now.
                            let tenMinsFromNow = currentTime;
                            tenMinsFromNow.setMinutes(tenMinsFromNow.getMinutes() + 10);
                            //log(`tenMinsFromNow: ${tenMinsFromNow.toISOString()}`);

                            getAccessToken().then(res => {
                                const accessToken = res;

                                //log(`access token: ${accessToken}`);

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
                                                'id': 'media Id from the request',
                                                'cause': 'cause of media creation',
                                                'recording': {
                                                    'name': 'Optional video name',
                                                    'startTime': convertDatetime(startTime),
                                                    'endTime': convertDatetime(stopTime),
                                                    'videoCodec': 'H264',
                                                    'audioCodec': 'G711',
                                                    'uri': {
                                                        'value': 'https://lindo.loginto.me:60945/public/alarm-video.mp4',
                                                        'expireTime': tenMinsFromNow.toISOString()
                                                    },
                                                    'thumbnailUri': {
                                                        'value': 'https://78.media.tumblr.com/70e7a471dec5e0c3e6807242bf838fd0/tumblr_muj26tUeaP1qj3dtso1_500.png',
                                                        'expireTime': tenMinsFromNow.toISOString()
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

                                return httpsPost(ALEXA_HOST, ALEXA_PATH, alexaHeaders, JSON.stringify(postData));
                            }).then((res) => {
                                log.debug(`result: ${res}`);
                            }).catch((err) => {
                                log.error(`post error: ${util.inspect(err, {showHidden: false, depth: null})}`);
                            });
                        }
                    }
                });
            });
        }
    })
    .on('unlink', path => {
        //log.debug(`File ${path} has been removed`)
    });