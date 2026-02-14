#!/bin/bash
cd "$(dirname "$0")"
source ~/.nvm/nvm.sh
nvm use v24.13.0
npx tsx src/index.ts
