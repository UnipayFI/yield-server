const axios = require('axios');
const sdk = require('@defillama/sdk');
const ethers = require('ethers');

const { addMerklRewardApy } = require('../merkl/merkl-additional-reward');

const lensAbi = require('./lens.abi.json');
const factoryAbi = require('./factory.abi.json');

const chains = {
  ethereum: {
    factory: '0x29a56a1b8214D9Cf7c5561811750D5cBDb45CC8e',
    vaultLens: '0xA8695d44EC128136F8Afcd796D6ba3Db3cdA8914',
    fromBlock: 20529225,
  },
  bob: {
    factory: '0x046a9837A61d6b6263f54F4E27EE072bA4bdC7e4',
    vaultLens: '0xb20343277ad78150D21CC8820fF012efDDa71531',
    fromBlock: 12266832,
  },
  sonic: {
    factory: '0xF075cC8660B51D0b8a4474e3f47eDAC5fA034cFB',
    vaultLens: '0x0058F402aaa67868A682DA1bDd2E08c7aA3795eE',
    fromBlock: 5324454,
  },
  avax: {
    factory: '0xaf4B4c18B17F6a2B32F6c398a3910bdCD7f26181',
    vaultLens: '0xeE2CaC5Df4984f56395b48e71b1D1E84acFbcD9E',
    fromBlock: 56805794,
  },
  berachain: {
    factory: '0x5C13fb43ae9BAe8470f646ea647784534E9543AF',
    vaultLens: '0xa61BC2Df76DBFCeDAe4fAaB7A1341bA98fA76FdA',
    fromBlock: 786314,
  },
  bsc: {
    factory: '0x7F53E2755eB3c43824E162F7F6F087832B9C9Df6',
    vaultLens: '0xBfD019C90e8Ca8286f9919DF31c25BF989C6bD46',
    fromBlock: 46370655,
  },
  base: {
    factory: '0x7F321498A801A191a93C840750ed637149dDf8D0',
    vaultLens: '0xCCC8D18e40c439F5234042FbEA0f4f1528f52f00',
    fromBlock: 22282408,
  },
  swellchain: {
    factory: '0x238bF86bb451ec3CA69BB855f91BDA001aB118b9',
    vaultLens: '0x1f1997528FbD68496d8007E65599637fBBe85582',
    fromBlock: 2350701,
  },
  unichain: {
    factory: '0xbAd8b5BDFB2bcbcd78Cc9f1573D3Aad6E865e752',
    vaultLens: '0x03833b4A873eA1F657340C72971a2d0EbB2B4D82',
    fromBlock: 8541544,
  },
  arbitrum: {
    factory: '0x78Df1CF5bf06a7f27f2ACc580B934238C1b80D50',
    vaultLens: '0x1Df19EE4Ed7353fCC54e26E54f960a19Aa43D304',
    fromBlock: 300690953,
  },
};

const getApys = async () => {
  const result = [];

  const factoryIFace = new ethers.utils.Interface(factoryAbi);

  for (const [chain, config] of Object.entries(chains)) {
    try {
      const currentBlock = await sdk.api.util.getLatestBlock(chain);
      const toBlock = currentBlock.number;

      // Fetch all pools from factory events
      const poolDeployEvents = await sdk.api.util.getLogs({
        fromBlock: config.fromBlock,
        toBlock: toBlock,
        target: config.factory,
        chain: chain,
        topic: '',
        keys: [],
        topics: [factoryIFace.getEventTopic('ProxyCreated')],
        entireLog: true,
      });

      const vaultAddresses = poolDeployEvents.output.map((event) => {
        const decoded = factoryIFace.decodeEventLog(
          'ProxyCreated',
          event.data,
          event.topics
        );
        return decoded['proxy'];
      });

      const vaultInfos = (
        await sdk.api.abi.multiCall({
          calls: vaultAddresses.map((address) => ({
            target: config.vaultLens,
            params: [address],
          })),
          abi: lensAbi.find((m) => m.name === 'getVaultInfoFull'),
          chain,
          permitFailure: true,
        })
      ).output.map((o) => o.output);

      // keep only pools with interest rate data
      const vaultInfosFilterted = vaultInfos.filter(
        (i) => i?.irmInfo?.interestRateInfo[0]?.supplyAPY > 0
      );

      const priceKeys = vaultInfosFilterted
        .map((i) => `${chain}:${i.asset}`)
        .join(',');

      const { data: prices } = await axios.get(
        `https://coins.llama.fi/prices/current/${priceKeys}`
      );

      const pools = vaultInfosFilterted.map((i) => {
        const price = prices.coins[`${chain}:${i.asset}`]?.price;

        const totalSupplied = i.totalAssets;
        const totalBorrowed = i.totalBorrowed;

        const totalSuppliedUSD =
          ethers.utils.formatUnits(totalSupplied, i.assetDecimals) * price;
        const totalBorrowedUSD =
          ethers.utils.formatUnits(totalBorrowed, i.assetDecimals) * price;

        return {
          pool: i.vault,
          chain,
          project: 'euler-v2',
          symbol: i.assetSymbol,
          poolMeta: i.vaultName,
          tvlUsd: totalSuppliedUSD - totalBorrowedUSD,
          totalSupplyUsd: totalSuppliedUSD,
          totalBorrowUsd: totalBorrowedUSD,
          apyBase: Number(
            ethers.utils.formatUnits(
              i.irmInfo.interestRateInfo[0].supplyAPY,
              25
            )
          ),
          apyBaseBorrow: Number(
            ethers.utils.formatUnits(
              i.irmInfo.interestRateInfo[0].borrowAPY,
              25
            )
          ),
          underlyingTokens: [i.asset],
          url: `https://app.euler.finance/vault/${i.vault}?network=${chain}`,
        };
      });
      result.push(pools);
    } catch (err) {
      console.error(`Error processing chain ${chain}:`, err);
    }
  }

  return await addMerklRewardApy(result.flat(), 'euler');
};

module.exports = {
  timetravel: false,
  apy: getApys,
};
