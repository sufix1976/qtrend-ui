@echo off
echo Starting V11 workers...

start cmd /k node v11_signal_worker_btcusd.cjs
start cmd /k node v11_signal_worker_linkusd.cjs
start cmd /k node v11_signal_worker_silver.cjs
start cmd /k node v11_signal_worker_gold.cjs

echo All workers started.
pause