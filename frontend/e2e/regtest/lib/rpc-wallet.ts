/**
 * `-rpcwallet=<name>` for a spec's own `rpc(...)` call (getnewaddress,
 * sendtoaddress, walletprocesspsbt): the bitcoind wallet the consumer stack's
 * bootstrap creates and funds, `REGTEST_WALLET`, with the same default the SDK's
 * bootstrap and regtest helpers use. The SDK exports no accessor for it, so a
 * spec that calls a wallet RPC directly names it here, once.
 */
export const RPC_WALLET_ARG = `-rpcwallet=${process.env.REGTEST_WALLET ?? 'ordpool-e2e'}`;
