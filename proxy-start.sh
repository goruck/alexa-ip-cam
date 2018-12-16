#!/bin/bash

# Read camera credentials and IP addresses.
# e.g., alexa:secret-passwd@192.168.1.15
. /home/lindo/develop/alexa-ip-cam/vars.sh

# Start the proxy server.
# Streams will be at rtsp://HOST_IP:554/proxyStream-n
# where n is the order of the input streams below.
# Each rtsp stream is at port 554 which is why the proxy is at port 8554.
/home/lindo/develop/live/proxyServer/live555ProxyServer -p 8554 \
  "rtsp://$CAM_1/axis-media/media.amp?streamprofile=alexa-ip-cam" \
  "rtsp://$CAM_2/axis-media/media.amp?streamprofile=alexa-ip-cam" \
  "rtsp://$CAM_3/axis-media/media.amp?streamprofile=alexa-ip-cam&camera=2" \
  "rtsp://$CAM_4/axis-media/media.amp?streamprofile=alexa-ip-cam" \
  "rtsp://$CAM_5/axis-media/media.amp?streamprofile=alexa-ip-cam" \
  "rtsp://$CAM_6/axis-media/media.amp?streamprofile=alexa-ip-cam" \
  "rtsp://$CAM_3/axis-media/media.amp?streamprofile=alexa-ip-cam&camera=1"