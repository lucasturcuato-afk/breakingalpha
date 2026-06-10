#!/usr/bin/env bash
input=$(cat)
file=$(printf '%s' "$input" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.stdout.write((j.tool_input&&j.tool_input.file_path)||"")}catch(e){}})')
case "$file" in
  *.ts|*.tsx) npx eslint --fix "$file" 2>&1 | tail -n 20 ;;
  *) : ;;
esac
