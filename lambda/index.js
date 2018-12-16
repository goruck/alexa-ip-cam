'use strict';

/**
 * Discover and show cameras on a local network without a cloud service.
 * This is part of the alexa-ip-cam project.
 * See https://github.com/goruck/alexa-ip-cam.
 * 
 * This demonstrates a smart home skill using the publicly available API on Amazon's Alexa platform.
 * For more information about developing smart home skills, see
 * https://developer.amazon.com/alexa/smart-home
 *
 * For details on the smart home API, please visit
 * https://developer.amazon.com/public/solutions/alexa/alexa-skills-kit/docs/smart-home-skill-api-reference
 * 
 * Copyright (c) Lindo St. Angel 2018.
 */

const fs = require('fs');
const uuidv4 = require('./node_modules/uuid/v4');

// Get general configuration.
const config = JSON.parse(fs.readFileSync('./config.json'));
//
const RECORDINGS_BASE_PATH = config.recordings.recordingsBasePath;
//
const VIDEO_URI_BASE = config.recordings.videoUriBase;

/**
 * Utility functions
 */

/**
 * Pretty logger.
 */
function log(title, msg) {
    console.log(`[${title}] ${msg}`);
}

/**
 * Generate a unique message ID
 *
 */
function generateMessageID() {
    return uuidv4();
}

/**
 * Generate a response message
 *
 * @param {string} name - Directive name
 * @param {Object} payload - Any special payload required for the response
 * @returns {Object} Response object
 */
function generateResponse(name, payload) {
    return {
        header: {
            messageId: generateMessageID(),
            name: name,
            namespace: 'Alexa.ConnectedHome.Control',
            payloadVersion: '2',
        },
        payload: payload,
    };
}

/**
 * Mock functions to access device cloud.
 *
 * TODO: Pass a user access token and call cloud APIs in production.
 */

function getDevicesFromPartnerCloud() {
    // Read and parse json containing camera configuration.
    // This is not actually from the cloud, rather emulates it. 
    const camerasObj = config;

    return camerasObj;
}

function isValidToken() {
    /**
     * Always returns true for sample code.
     * You should update this method to your own access token validation.
     */
    return true;
}

function isDeviceOnline(applianceId) {
    log('DEBUG', `isDeviceOnline (applianceId: ${applianceId})`);
    /**
     * Always returns true for sample code.
     * You should update this method to your own validation.
     */
    return true;
}

/**
 * Main logic
 */

/**
 * This function is invoked when we receive a "Discovery" message from Alexa Smart Home Skill.
 * We are expected to respond back with a list of appliances that we have discovered for a given customer.
 *
 * @param {Object} request - The full request object from the Alexa smart home service. This represents a DiscoverAppliancesRequest.
 *     https://developer.amazon.com/public/solutions/alexa/alexa-skills-kit/docs/smart-home-skill-api-reference#discoverappliancesrequest
 *
 * @param {function} callback - The callback object on which to succeed or fail the response.
 *     https://docs.aws.amazon.com/lambda/latest/dg/nodejs-prog-model-handler.html#nodejs-prog-model-handler-callback
 *     If successful, return <DiscoverAppliancesResponse>.
 *     https://developer.amazon.com/public/solutions/alexa/alexa-skills-kit/docs/smart-home-skill-api-reference#discoverappliancesresponse
 */
function handleDiscovery(request, callback) {
    log('DEBUG', `Discovery Request: ${JSON.stringify(request)}`);

    /**
     * Get the OAuth token from the request.
     */
    const userAccessToken = request.directive.payload.scope.token.trim();

    /**
     * Generic stub for validating the token against your cloud service.
     * Replace isValidToken() function with your own validation.
     */
    if (!userAccessToken || !isValidToken(userAccessToken)) {
        const errorMessage = `Discovery Request [${request.header.messageId}] failed. Invalid access token: ${userAccessToken}`;
        log('ERROR', errorMessage);
        callback(new Error(errorMessage));
    }

    /**
     * Assume access token is valid at this point.
     * Retrieve list of devices from cloud based on token.
     *
     * For more information on a discovery response see
     *  https://developer.amazon.com/public/solutions/alexa/alexa-skills-kit/docs/smart-home-skill-api-reference#discoverappliancesresponse
     */

    /**
     * Form and send discover response event.
     *
     */
    const header = {
        messageId: generateMessageID(),
        name: 'Discover.Response',
        namespace: 'Alexa.Discovery',
        payloadVersion: '3'
    };

    const camerasObj = getDevicesFromPartnerCloud();

    let endpoints = [];
    for (let i = 0, len = camerasObj.cameras.length; i < len; i++) {
        let _resolutions = [];
        for (let j = 0, len = camerasObj.cameras[i].resolutions.length; j < len; j++) {
            _resolutions.push({'width': camerasObj.cameras[i].resolutions[j].width,
                'height': camerasObj.cameras[i].resolutions[j].height});
        }

        const endpoint = {
            endpointId: camerasObj.cameras[i].endpointId,
            manufacturerName: camerasObj.cameras[i].manufacturerName,
            modelName: camerasObj.cameras[i].modelName,
            friendlyName: camerasObj.cameras[i].friendlyName,
            description: camerasObj.cameras[i].description,
            displayCategories: ['CAMERA'],
            cookie: {},
            capabilities: [
                {
                    type: 'AlexaInterface',
                    interface: 'Alexa.CameraStreamController',
                    version: '3',
                    cameraStreamConfigurations: [
                        {
                            protocols: ['RTSP'], 
                            resolutions: _resolutions,
                            authorizationTypes: ['NONE'], 
                            videoCodecs: ['H264'],
                            audioCodecs: ['NONE'] 
                        }]
                },
                {
                    type: 'AlexaInterface',
                    interface: 'Alexa.MediaMetadata',
                    version: '3',
                    proactivelyReported: true
                }
            ]
        };
        endpoints.push(endpoint);
    }

    const response = {
        'event': {header, 'payload': {endpoints}}
    };

    /**
     * Log the response. These messages will be stored in CloudWatch.
     */
    log('DEBUG', `Discovery Response: ${JSON.stringify(response)}`);

    /**
     * Return result with successful message.
     */
    callback(null, response);
}

/**
 * A function to handle control events.
 * This is called when Alexa requests an action such as turning off an appliance.
 *
 * @param {Object} request - The full request object from the Alexa smart home service.
 * @param {function} callback - The callback object on which to succeed or fail the response.
 */
function handleControl(request, callback) {
    log('DEBUG', `Control Request: ${JSON.stringify(request)}`);

    /**
     * Get the access token.
     */
    const userAccessToken = request.directive.endpoint.scope.token.trim();

    /**
     * Generic stub for validating the token against your cloud service.
     * Replace isValidToken() function with your own validation.
     *
     * If the token is invalid, return InvalidAccessTokenError
     *  https://developer.amazon.com/public/solutions/alexa/alexa-skills-kit/docs/smart-home-skill-api-reference#invalidaccesstokenerror
     */
    if (!userAccessToken || !isValidToken(userAccessToken)) {
        log('ERROR', `Discovery Request [${request.header.messageId}] failed. Invalid access token: ${userAccessToken}`);
        callback(null, generateResponse('InvalidAccessTokenError', {}));
        return;
    }

    /**
     * Grab the applianceId from the request.
     */
    const applianceId = request.directive.endpoint.endpointId;

    /**
     * If the applianceId is missing, return UnexpectedInformationReceivedError
     *  https://developer.amazon.com/public/solutions/alexa/alexa-skills-kit/docs/smart-home-skill-api-reference#unexpectedinformationreceivederror
     */
    if (!applianceId) {
        log('ERROR', 'No applianceId provided in request');
        const payload = { faultingParameter: `applianceId: ${applianceId}` };
        callback(null, generateResponse('UnexpectedInformationReceivedError', payload));
        return;
    }

    /**
     * At this point the applianceId and accessToken are present in the request.
     *
     * Please review the full list of errors in the link below for different states that can be reported.
     * If these apply to your device/cloud infrastructure, please add the checks and respond with
     * accurate error messages. This will give the user the best experience and help diagnose issues with
     * their devices, accounts, and environment
     *  https://developer.amazon.com/public/solutions/alexa/alexa-skills-kit/docs/smart-home-skill-api-reference#error-messages
     */
    if (!isDeviceOnline(applianceId, userAccessToken)) {
        log('ERROR', `Device offline: ${applianceId}`);
        callback(null, generateResponse('TargetOfflineError', {}));
        return;
    }

    /**
     * Form and send response event.
     *
     */
    const correlation_Token = request.directive.header.correlationToken;

    // TODO: handle multiple camera streams
    const _width = request.directive.payload.cameraStreams[0].resolution.width;
    const _height = request.directive.payload.cameraStreams[0].resolution.height;
    
    const header = {
        correlationToken: correlation_Token,
        messageId: generateMessageID(),
        name: 'Response',
        namespace: 'Alexa.CameraStreamController',
        payloadVersion: '3'
    };

    // Get uri of camera using applianceId as an index. 
    const camerasObj = getDevicesFromPartnerCloud();
    const cameraIdx = parseInt(applianceId) - 1;
    const _uri = camerasObj.cameras[cameraIdx].uri;
    
    const payload = {
        cameraStreams: [
            {
                uri: _uri,
                protocol: 'RTSP',
                resolution: {width: _width, height: _height},
                authorizationType: 'NONE',
                videoCodec: 'H264',
                audioCodec: 'NONE'
            }]
    };

    const response = {
        event: {header, payload}
    };
        
    log('DEBUG', `Control Confirmation: ${JSON.stringify(response)}`);

    callback(null, response);
}

/**
 * This handles an AcceptGrant directive.
 * This enables you to obtain credentials that identify and authenticate a customer to Alexa.
 * See https://developer.amazon.com/docs/device-apis/alexa-authorization.html.
 * 
 * @param {object} request - The full request object from the Alexa smart home service.
 * @param {function} callback - The callback object on which to succeed or fail the response.
 */
function handleAcceptGrant (request, callback) {
    log('DEBUG', `Accept Grant: ${JSON.stringify(request)}`);

    const response = {
        event: {
            header: {
                messageId: generateMessageID(),
                namespace: 'Alexa.Authorization',
                name: 'AcceptGrant.Response',
                payloadVersion: '3'
            },
            payload: {
            }
        }
    };

    callback(null, response);
}

/**
 * This forms the response to a GetMediaMetadata directive.
 * See https://developer.amazon.com/docs/device-apis/alexa-mediametadata.html.
 * 
 * @param {object} request - The full request object from the Alexa smart home service.
 * @param {function} callback - The callback object on which to succeed or fail the response.
 */
function handleMediaMetadata (request, callback) {
    log('DEBUG', `MediaMetadata: ${JSON.stringify(request)}`);

    const mediaId = request.directive.payload.filters.mediaIds[0];

    // Replace underscores with slashes to reform path to recordings.
    // Underscores were used in the media id to be compatible w/Alexa MediaMetadata API.
    const mediaIdArr = mediaId.split('__');
    const manufacturerId = mediaIdArr[0]+'-'+mediaIdArr[1];
    const mediaUri = VIDEO_URI_BASE+RECORDINGS_BASE_PATH+
        manufacturerId+'/'+mediaIdArr.slice(2).join('/')+'.mp4';
    log('DEBUG', `mediaUri: ${mediaUri}`);

    let tenMinsFromNow = new Date();
    tenMinsFromNow.setMinutes(tenMinsFromNow.getMinutes() + 10);

    const response = {
        event: {
            header: {
                namespace: 'Alexa.MediaMetadata',
                name: 'GetMediaMetadata.Response',
                messageId: generateMessageID(),
                correlationToken: request.directive.header.correlationToken,
                payloadVersion: '3'
            },
            payload: {
                media: [{
                    id: request.directive.payload.filters.mediaIds[0],
                    cause: 'MOTION_DETECTED',
                    recording: {
                        //'name': 'Optional video name',
                        //'startTime': '2018-06-29T19:20:41Z',
                        //'endTime': '2018-06-29T19:21:41Z',
                        //'videoCodec': 'H264',
                        //'audioCodec': 'NONE',
                        uri: {
                            value: mediaUri,
                            expireTime: tenMinsFromNow.toISOString().split('.')[0]+'Z'
                        }
                    }
                }]
                /*'errors': [{
                    'mediaId': 'media id from the request',
                    'status': 'reason for error'
                }]*/
            }
        }
    };

    callback(null, response);
}

/**
 * Main entry point.
 * Incoming events from Alexa service through Smart Home API are all handled by this function.
 *
 * It is recommended to validate the request and response with Alexa Smart Home Skill API Validation package.
 * https://github.com/alexa/alexa-smarthome-validation
 */
exports.handler = (request, context, callback) => {
    switch (request.directive.header.namespace) {
        /**
         * The namespace of 'Alexa.ConnectedHome.Discovery' indicates a request is being made to the Lambda for
         * discovering all appliances associated with the customer's appliance cloud account.
         *
         * For more information on device discovery, please see
         * https://developer.amazon.com/public/solutions/alexa/alexa-skills-kit/docs/smart-home-skill-api-reference#discovery-messages
         */
    case 'Alexa.Discovery':
        handleDiscovery(request, callback);
        break;

        /**
         * The namespace of "Alexa.CameraStreamController" indicates a request is being made to initialize a camera stream for an endpoint.
         * The full list of Control events sent to your lambda are described below.
         *  https://developer.amazon.com/public/solutions/alexa/alexa-skills-kit/docs/smart-home-skill-api-reference#payload
         */
    case 'Alexa.CameraStreamController':
        handleControl(request, callback);
        break;

        /**
         * Accept Grant.
         * This enables you to obtain credentials that identify and authenticate a customer to Alexa.
         * See https://developer.amazon.com/docs/device-apis/alexa-authorization.html.
         */
    case 'Alexa.Authorization':
        handleAcceptGrant(request, callback);
        break;

        /**
         * GetMediaMetadata.
         * Sent when Alexa needs to update information about the media recording, such as updating the URL.
         * See https://developer.amazon.com/docs/device-apis/alexa-mediametadata.html.
         */
    case 'Alexa.MediaMetadata':
        handleMediaMetadata(request, callback);
        break;

        /**
         * The namespace of "Alexa.ConnectedHome.Query" indicates a request is being made to query devices about
         * information like temperature or lock state. The full list of Query events sent to your lambda are described below.
         *  https://developer.amazon.com/public/solutions/alexa/alexa-skills-kit/docs/smart-home-skill-api-reference#payload
         *
         * TODO: In this sample, query handling is not implemented. Implement it to retrieve temperature or lock state.
         */
        // case 'Alexa.ConnectedHome.Query':
        //     handleQuery(request, callback);
        //     break;

        /**
         * Received an unexpected message
         */
    default: {
        const errorMessage = `No supported namespace: ${request.directive.header.namespace}`;
        log('ERROR', errorMessage);
        callback(new Error(errorMessage));
    }
    }
};

