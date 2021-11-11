***IMPORTANT NOTE: At the current time some Amazon devices may not work with this project because they don't properly manage the recent Let's Encrypt root certification expiration. I am working with Amazon to fix things on their side but in the meantime the steps described below should work with the majority of Amazon devices.***

# alexa-ip-cam

Use Alexa's Smart Home Skill API with standalone IP cameras to stream live video and recorded video to an Alexa device without needing any camera cloud service. 

## Background

Many people like myself have IP cameras without a cloud service that perhaps they'd like to control using Amazon's Alexa [Smart Home Skill API](https://developer.amazon.com/docs/smarthome/understand-the-smart-home-skill-api.html). This API is great but assumes you are using a cloud service for your cameras and has very specific security and streaming requirements that makes it challenging to connect standalone cameras. In my case I have several [Axis IP cameras](https://www.axis.com/us/en/products/network-cameras) around the house connected via a LAN to a local Linux machine and are configured to do motion detection and store recordings on the Linux box. I also use [Zoneminder](https://zoneminder.com/) as a Network Video Recorder and its mobile companion app zmNinja. No camera cloud service is needed in my system which avoids associated recurring costs BUT the system is not Alexa compatible "out of the box".

So I created the alexa-ip-camera project to solve this problem and enable me to view my home's live and recorded camera streams on Amazon devices such as the Echo Show, the Echo Spot and the FireTV. To do that I had to develop an Alexa Smart Home skill plus some supporting components running on the local Linux machine.

Note: Please see my related [smart-zoneminder](https://github.com/goruck/smart-zoneminder) project that enables fast upload of [ZoneMinder](https://www.zoneminder.com/) alarm frame images to an S3 archive where they are analyzed by Amazon Rekognition or locally by Tensorflow and made accessible by voice via Alexa.

I hope others find this useful. I've described the project in some detail and outlined the steps below that I used to create this skill.

## System Architecture

The system consists of the following main components.

1. An Alexa Smart Home skill.
2. An AWS Lambda instance for handling the skill intents including camera discovery and control.
3. An Alexa-enabled device with a display such as Amazon Echo Show or Spot.
3. A RTSP proxy running on the local linux machine that aggregates the streams from the cameras on the LAN into one front-end stream. This component isn't needed if you only have one camera. I used The [LIVE555 Proxy Server](http://www.live555.com/proxyServer/).
4. A TLS encryption proxy on the local linux machine that encypts the stream from the RTSP proxy server and streams it on local machine's port 443. I used [stunnel](https://www.stunnel.org/index.html).
6. A program running on the local linux machine that uploads camera recording metadata to the Alexa Event Gateway via the [Alexa.MediaMetadata Interface](https://developer.amazon.com/docs/device-apis/alexa-mediametadata.html) to enable the viewing of past events captured by the camera. In my case I used a node.js app I created called [process-events.js](https://github.com/goruck/alexa-ip-cam/blob/master/process-events/process-events.js).
7. A webserver running on the local linux machine that allows the Lambda instance to access the recordings stored by the cameras. I'm using Apache. 

## Prerequisites

You'll need the following setup before starting this project. 

1. An [Amazon Developers](https://developer.amazon.com/) account.
2. An [Amazon AWS](https://aws.amazon.com/) account.
3. IP camera(s) connected to your LAN that support streaming over RTSP and local recordings.
4. A Linux machine connected to your LAN. I used an existing server running Ubuntu 18.04 but a Raspberry Pi, for example, would be fine.

## Installation Steps

### Clone this repo

### Configure General Settings

Copy [config-template.json](./config-template.json) to a file called config.json. There are several values in that file that need to be changed to suit your setup. Some of them are described below. 

### Setup the Alexa Smart Home Skill and and Lambda handler

The [Steps to Build a Smart Home Skill](https://developer.amazon.com/docs/smarthome/steps-to-build-a-smart-home-skill.html) and [Build Smart Home Camera Skills](https://developer.amazon.com/docs/smarthome/build-smart-home-camera-skills.html) on the Amazon Alexa Developers site give detailed instructions on how to create the skill and how the API works. Replace the Lambda code in the template example with the code in index.js in [lambda](https://github.com/goruck/alexa-ip-cam/tree/master/lambda) directory of this repo. The code emulates the camera configuration data that would normally come from a 3rd party camera cloud service. You'll have to edit config.json to make it reflect your camera names and specs.

### Setup the RTSP Proxy

[emtunc's blog](https://emtunc.org/blog/) provides excellent [instructions](https://emtunc.org/blog/02/2016/setting-rtsp-relay-live555-proxy/) on how to setup the proxy from Live555. I needed to set OutPacketBuffer::maxSize to 400000 bytes in live555ProxyServer.cpp to stop the feed from getting truncated. I didn't make the other changes that emtunc made (port and stream naming). 

The RTSP proxy needs to be on a different port than the individual streams. In my case the proxy port is 8554 since the cameras have their RTSP port set to 554. The proxy is therefore started with ```-p 8554``` on the command line. You have to make sure nothing else is using that port on the server running the proxy. 

The [proxy-start script](./proxy-start.sh) is run as a cronjob as root at boot to start the RTSP proxy. The cronjob is delayed by 60 secs to allow networking to come up first.

### Setup DNS and SSL certs

I followed the corresponding steps in [CameraPi](https://github.com/sammachin/camerapi) almost exactly except I'm using GoDaddy to manage domains and DNS instead of AWS Route 53. Note: Let’s Encrypt CA issues short-lived certificates (90 days). Make sure you [renew the certificates](https://certbot.eff.org/docs/using.html#renewing-certificates) at least once in 3 months.

At the current time you should configure your ACME client to use the *alternative chain* instead of the *default chain* when requesting a cert from Let's Encrypt because this allows most Amazon devices to properly handle Let's Encrypt's recent root cert expiration. For more information on this issue please see [Old Let’s Encrypt Root Certificate Expiration and OpenSSL 1.0.2](https://www.openssl.org/blog/blog/2021/09/13/LetsEncryptRootCertExpire/). I use [certbot](https://certbot.eff.org/) as an ACME client and the command to do so is shown below.

```bash
$ sudo certbot -d URI --rsa-key-size 4096 --manual \
--preferred-challenges dns \
--preferred-chain "ISRG Root X1" certonly
```

Per the Alexa Smart Home camera [documentation](https://developer.amazon.com/docs/smarthome/build-smart-home-camera-skills.html#local-and-remote-execution-recommendations) you can provide the API a local or remote camera URI. I'm currently providing a local URI but did try remote as well since I was a little concerned about putting a private IP address in a DNS record. But local results in lower latency over remote but its not a lot, only about 500 ms and I didn't have to open a port to the Internet in my firewall. The biggest drawback is that I won't be able to view my cameras on an Echo device outside my home, for example at work. 

### Setup the TLS encryption proxy

stunnel is a ubuntu package so it easy to install using apt-get as root. The configuration I used is in the file [stunnel.conf](./stunnel.conf) which is placed in /etc/stunnel/stunnel.conf on my machine. stunnel is run as a cronjob as root at boot to start it. The cronjob is delayed by 60 secs to allow networking to come up first.

### Setup Camera

I created a user for Alexa access and a streaming profile for each camera. The settings for the profile are shown in the table below. Note the specific settings. These are the only values that have been tested so you should use the same or be prepared to experiment.

| Parameter     | Value         | Units |
| ------------- |:-------------:| -----:|
| Resolution    | 1280x720      | pixels|
| Encoder Type     | H.264      |   NA |
| Encoder Compression | 30      |    NA |
| Encoder Max Frame Rate | Unlimited      |    NA |
| Encoder GOP | 62      |  frames |
| Encoder Profile | Baseline     |    NA |
| Encoder Bit Rate Control | Variable      |    NA |

### Setup Camera Local Recording and Processing

Most modern IP cameras allow you to store a recording to a local drive triggered from motion detection or another event. This needs to be enabled to use the [Alexa Cameras Recap API](https://developer.amazon.com/blogs/alexa/post/853661dc-b4f9-4c28-bc5f-1b81f00117bf/enable-customers-to-access-recorded-video-feeds-with-alexa-via-the-cameras-recap-api) which allows you to view those recordings.

You'll need to change [config.json](https://github.com/goruck/alexa-ip-cam/blob/master/config-template.json) to point the [process-events.js](https://github.com/goruck/alexa-ip-cam/blob/master/process-events/process-events.js) app that processes the recordings and most likely the app itself to suit the particular way your camera stores recordings. The code here has only been tested against Axis cameras. The process-events.js app is run as a Linux service using systemd.

### Authenticate Yourself to Alexa with Permissions

As mentioned above the recording metadata is sent to the Alexa Gateway. This is done asynchronously and so you must provide the proper authentication information with the request. Follow the steps outlined in [Authenticate a Customer to Alexa with Permissions](https://developer.amazon.com/docs/smarthome/authenticate-a-customer-permissions.html) to make this happen. You'll also need to add the relevant information to config.json.

Also see [Authorization Code Grant](https://developer.amazon.com/docs/login-with-amazon/authorization-code-grant.html), [Alexa.Authorization Interface](https://developer.amazon.com/docs/device-apis/alexa-authorization.html) and [Send Events to the Event Gateway](https://developer.amazon.com/docs/smarthome/send-events-to-the-alexa-event-gateway.html) for more information on how this works.

### Setup Webserver

A webserver is required to serve up the camera recordings to the skill's lambda function running in the AWS cloud. I'm using Apache and for this purpose. I just created a virtual host that pointed to the directory where the cameras store their recordings. Note that Alexa Smart Home API requires this connection to be over https and self-signed certs may not be used as outlined above in the SSL cert section. 

## Operation

Once everything is setup you need to enable your skill in the Alexa companion mobile app or web app. Then ask Alexa to "discover devices" and your camera(s) should be found, Alexa will tell you that and they'll be visible in the app. After that just ask Alexa to "show front porch camera" (or what every you named them) and the camera video will be streamed to your Echo device with a screen. Or you can say "Alexa, show the event that just happened at the front porch camera" to see the last recorded event. 

## Results

Overall the skill works well but the latency between asking Alexa to show a camera and the video appearing on the Echo's or FireTV screen is a little too long for a great experience, on average 3 secs or so. I haven't yet tracked down the cause of it.

Also I've seen the video re-buffer occasionally which can be irritating and once in a great while the video freezes during rebuffering. I've found that the camera settings above minimize the buffering across all the Amazon Alexa devices I've tested. I think the source of the buffering is the video decode time in the device which varies across device type due to hardware capabilities. Since the the video is delivered to the device from the camera via TCP (stunnel uses SSL over TCP) the network will not let the device discard packets when gets it gets behind in its decoding. I don't know a way to use stunnel with UDP which would obviate this issue. The table below shows the device types I've tested and video quality performance.

| Device     | Buffering Frequency         | Note |
| ------------- |:-------------:| -----:|
| Fire TV Cube  | Never      | Expected since the device is optimized for video.|
| Fire TV Stick 4K  | Never | Expected since the device is optimized for video. |
| Echo Show Gen 1| Rarely | |
| Echo Show Gen 2 | Rarely|  |
| Fire HD 10 Tablet  | Occasionally     | Expected given its hardware capabilities.|

## Acknowledgments

I looked for other projects on GitHub for code to leverage but didn't find anything exactly solving my particular problem. However I did find an excellent repo called [CameraPi](https://github.com/sammachin/camerapi) from [Sam Machin](https://github.com/sammachin) that describes how to use Alexa to control a camera connected to a Raspberry PI that I used as a basis for my effort. Thank you Sam!

I used [emtunc's very cool blog](https://emtunc.org/blog/) to learn how to setup the RTSP proxy. Thank you emtunc!
