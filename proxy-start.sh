#!/bin/bash

# Read camera credentials and IP addresses.
# e.g., alexa:secret-passwd@192.168.1.15
. /home/lindo/dev/show-cameras/vars.sh

# Start the proxy server.
# Streams will be at rtsp://HOST_IP:554/proxyStream-n
# where n is the order of the input streams below.
/home/lindo/dev/live/proxyServer/live555ProxyServer \
  rtsp://$CAM_1/onvif-media/media.amp?profile=profile_alexa_h264 \
  rtsp://$CAM_2/onvif-media/media.amp?profile=profile_alexa_h264 \
  rtsp://$CAM_3/onvif-media/media.amp?profile=profile_alexa_h264 \
  rtsp://$CAM_4/onvif-media/media.amp?profile=profile_alexa_h264 \
  rtsp://$CAM_5/onvif-media/media.amp?profile=profile_alexa_h264 \
  rtsp://$CAM_6/onvif-media/media.amp?profile=profile_alexa_h264
