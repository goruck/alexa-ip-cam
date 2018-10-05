*NEW - Now using the Alexa Cameras Recap API allowing for stored recordings to be viewed.*

# alexa-ip-cam

Use Alexa's Smart Home Skill API with standalone IP cameras to stream live video and recorded video to an Alexa device without needing any camera cloud service. 

## Background

Many people like myself have IP cameras without a cloud service that they'd like to control using Amazon's Alexa [Smart Home Skill API](https://developer.amazon.com/docs/smarthome/understand-the-smart-home-skill-api.html). The Smart Home Skill API is great but assumes you are using a cloud service for your cameras and has very specific security and streaming requirements that makes it challenging to connect standalone cameras. In my case I have several [Axis IP cameras](https://www.axis.com/us/en/products/network-cameras) around the house connected via my LAN to a local Linux server running the [Zoneminder](https://zoneminder.com/) NVR software which records the streams and provides event detection. The Axis cameras can also be configured to do event detection and store recordings locally. I.e, no camera cloud service is needed in my system which avoids associated recurring costs.

Therefore I started this project to allow me to view live and recorded camera streams on Amazon devices such as the Echo Show, the Echo Spot and the FireTV and to do that I had to develop an Alexa Smart Home skill. 

I looked for other projects on GitHub for code to leverage but didn't find anything exactly solving my particular problem. However I did find an excellent repo called [CameraPi](https://github.com/sammachin/camerapi) from [Sam Machin](https://github.com/sammachin) that describes how to use Alexa to control a camera connected to a Raspberry PI that I used as a basis for my effort. Thank you Sam!

Note: Please see my related [smart-zoneminder](https://github.com/goruck/smart-zoneminder) project that enables fast upload of [ZoneMinder](https://www.zoneminder.com/) alarm frame images to an S3 archive where they are analyzed by Amazon Rekognition and made accessible by voice via Alexa.

I hope others find this useful. I've described the project in some detail and outlined the steps below that I used to create this skill.

## System Architecture

The system consists of the following main componenets.

1. An Alexa Smart Home skill.
2. An AWS Lambda instance for handling the skill intents including camera discovery and control.
3. An Alexa-enabled device with a display such as Amazon Echo Show or Spot.
3. A RTSP proxy running on the local linux machine that aggregates the streams from the cameras on the LAN into one front-end stream. This component isn't needed if you only have one camera. I used The [LIVE555 Proxy Server](http://www.live555.com/proxyServer/).
4. A TLS encryption proxy on the local linux machine that encypts the stream from the RTSP proxy server and streams it on local machine's port 443. I used [stunnel](https://www.stunnel.org/index.html).
6. A program running on the local linux machine that uploads camera recording metadata to the Alexa Event Gateway via the [Alexa.MediaMetadata Interface](https://developer.amazon.com/docs/device-apis/alexa-mediametadata.html#media-object) to enable the viewing of past events captured by the camera. In my case I used this [node.js]() app. 
7. A webserver running on the local linux machine that allows the Lambda instance to access the recordings stored by the cameras. I'm using Apache. 

## Prerequisites

You'll need the following setup before starting this project. 

1. An [Amazon Developers](https://developer.amazon.com/) account.
2. An [Amazon AWS](https://aws.amazon.com/) account.
3. IP camera(s) that support ONVIF and connected to your LAN.
4. A Linux machine connected to your LAN. I used an existing server running Ubuntu 18.04 but a Raspberry Pi, for example, would be fine.

## Installation Steps

### Clone this repo

### Configure General Settings

Copy config-template.json to config.json. There are several values that need to be changed to suit your setup. Some of them are described below. 

### Setup the Alexa Smart Home Skill and and Lambda handler

The [Steps to Build a Smart Home Skill](https://developer.amazon.com/docs/smarthome/steps-to-build-a-smart-home-skill.html) and [Build Smart Home Camera Skills](https://developer.amazon.com/docs/smarthome/build-smart-home-camera-skills.html) on the Amazon Alexa Developers site give detailed instructions on how to create the skill and how the API works. Replace the Lambda code in the template example with the code in [lambda]() directory of this repo. The code emulates the camera configuration data that would normally come from a 3rd party camera cloud service. You'll have to edit [config.json]() to make it reflect your camera names and specs.

### Setup the RTSP Proxy

[emtunc's blog](https://emtunc.org/blog/) provides excellent [instructions](https://emtunc.org/blog/02/2016/setting-rtsp-relay-live555-proxy/) on how to setup the proxy from Live555. I needed to set OutPacketBuffer::maxSize to 400000 bytes in live555ProxyServer.cpp to stop the feed from getting truncated. I didn't make the other changes that emtunc made (port and stream naming). The proxy-start script is run as a cronjob as root at boot to start it. The cronjob is delayed by 60 secs to allow networking to come up first.

### Setup DNS and SSL certs

I followed the corresponding steps in [CameraPi](https://github.com/sammachin/camerapi) almost exactly except I'm using GoDaddy to manage domains and DNS instead of AWS Route 53. Note: Let’s Encrypt CA issues short-lived certificates (90 days). Make sure you [renew the certificates](https://certbot.eff.org/docs/using.html#renewing-certificates) at least once in 3 months.

Per the Alexa Smart Home camera [documentation](https://developer.amazon.com/docs/smarthome/build-smart-home-camera-skills.html#local-and-remote-execution-recommendations) you can provide the API a local or remote camera URI. I'm currently providing a local URI but did try remote as well since I was a little concerned about putting a private IP address in a DNS record. But local results in lower latency over remote but its not a lot, only about 500 ms and I didn't have to open a port to the Internet in my firewall. The biggest drawback is that I won't be able to view my cameras on an Echo device outside my home, for example at work. 

### Setup the TLS encryption proxy

stunnel is a ubuntu package so it easy to install using apt-get as root. The configuration I used is in the file stunnel.conf which is placed in /etc/stunnel/stunnel.conf. stunnel is run as a cronjob as root at boot to start it. The cronjob is delayed by 60 secs to allow networking to come up first.

### Setup Camera ONVIF

I created an ONVIF user for Alexa access and a profile for each camera. The settings for the profile are shown in the figure below.

![Alt text](/images/onvif-profile.jpg?raw=true "AXIS camera onvif profile for Alexa.")

### Setup Camera Local Recording

Most modern IP cameras allow you to store a recording to a local drive triggered from motion detection or another event. This needs to be enabled to use the [Alexa Cameras Recap API](https://developer.amazon.com/blogs/alexa/post/853661dc-b4f9-4c28-bc5f-1b81f00117bf/enable-customers-to-access-recorded-video-feeds-with-alexa-via-the-cameras-recap-api) which allows you to view those recordings. You'll need to change config.json to point the node.js app that processes events to the recordings and most likely the app itself to suit the particular way your camera stores recordings.

### Authenticate Yourself to Alexa with Permissions

As mentioned above the recording metadata is sent to the Alexa Gateway. This is done asynchronously and so you must provide the proper authentication information with the request. Follow the steps outlined in [Authenticate a Customer to Alexa with Permissions](https://developer.amazon.com/docs/smarthome/authenticate-a-customer-permissions.html#notification-of-expired-token-and-using-the-refresh-token) to make this happen. You'll also need to add the relevant information to config.json.

Also see [Authorization Code Grant](https://developer.amazon.com/docs/login-with-amazon/authorization-code-grant.html#Using%20Refresh%20Tokens), [Alexa.Authorization Interface](https://developer.amazon.com/docs/device-apis/alexa-authorization.html) and [Send Events to the Event Gateway](https://developer.amazon.com/docs/smarthome/send-events-to-the-alexa-event-gateway.html) for more information on how this works.

### Setup Webserver

A webserver is required to serve up the camera recordings to the skill's lambda function running in the AWS cloud. I'm using Apache and for this purpose. I just created a virtual host that pointed to the directory where the cameras store their recordings. Note that Alexa Smart Home API requires this connection to be over https and self-signed certs may not be used as outlined above in the SSL cert section. 

## Operation

Once everything is setup you need to enable your skill in the Alexa companion mobile app or web app. Then ask Alexa to "discover devices" and your camera(s) should be found, Alexa will tell you that and they'll be visible in the app. After that just ask Alexa to "show front porch camera" (or what every you named them) and the camera video will be streamed to your Echo device with a screen. Or you can say "Alexa, show the event that just happened at the front porch camera" to see the last recorded event. 

## Results

Overall the skill works well but the latency between asking Alexa to show a camera and the video appearing on the Echo's or FireTV screen is a little too long for a great experience, on average 5 secs or so. I haven't yet tracked down the cause of it. Also I've seen the video re-buffer occasionally which can be irritating and once in a great while the video freezes during rebuffering. Again, I'll track this down and optimize.
