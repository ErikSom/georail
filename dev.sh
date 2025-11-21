#!/bin/bash

# Run both app and server dev servers in parallel
# Use trap to kill both processes when script is terminated

trap 'kill 0' EXIT

cd app && npm run dev &
cd server && npm run dev &

wait
