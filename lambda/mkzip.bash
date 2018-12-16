#!/bin/bash
echo "starting zip"
zip index.zip index.js
zip -j index.zip ../config.json
zip -r index.zip node_modules/
