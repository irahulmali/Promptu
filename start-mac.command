#!/bin/bash
# Get the directory where this script is located
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR"

# Start the Node.js server in the background
nohup node server.js > /dev/null 2>&1 &

# Close the Terminal window that automatically opened
osascript -e 'tell application "Terminal" to close first window' & exit
