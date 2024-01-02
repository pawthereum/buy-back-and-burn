import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import hre from "hardhat";
import { PancakeFactory, PancakeRouter, Pawthereum, PawthereumBuyBackAndBurn, WBNB } from "../typechain-types";

describe("Buy back and burn", function () {
  let owner: SignerWithAddress;
  let multiSig: SignerWithAddress;
  let addrs: SignerWithAddress[];
  let pawthereum: Pawthereum;
  let pancakeFactory: PancakeFactory;
  let pancakeRouter: PancakeRouter;
  let weth: WBNB;
  let pawthereumBuyBackAndBurn: PawthereumBuyBackAndBurn;

  // `beforeEach` will run before each test, re-deploying the contract every
  // time. It receives a callback, which can be async.
  beforeEach(async function () {
    // addresses
    [owner, multiSig, ...addrs] = await hre.ethers.getSigners();

    weth = await hre.ethers.deployContract(
      "WBNB",
      [],
      owner,
    );
    await weth.waitForDeployment();

    pancakeFactory = await hre.ethers.deployContract(
      "PancakeFactory",
      [owner.address],
      owner,
    );
    await pancakeFactory.waitForDeployment();

    const setFeeTo = await pancakeFactory.setFeeTo(owner.address);
    await setFeeTo.wait();

    pancakeRouter = await hre.ethers.deployContract(
      "PancakeRouter",
      [
        await pancakeFactory.getAddress(), 
        await weth.getAddress(),
      ],
      owner,
    );
    await pancakeRouter.waitForDeployment();

    pawthereum = await hre.ethers.deployContract(
      "Pawthereum",
      [
        await addrs[5].getAddress(),
        await addrs[6].getAddress(),
        await addrs[7].getAddress(),
        await pancakeRouter.getAddress(),
      ],
      owner,
    );
    await pawthereum.waitForDeployment();
    
    pawthereumBuyBackAndBurn = await hre.ethers.deployContract(
      "PawthereumBuyBackAndBurn",
      [
        await pawthereum.getAddress(),
        await weth.getAddress(),
        "0x000000000000000000000000000000000000dEaD",
        await pancakeRouter.getAddress(),
        await multiSig.getAddress(),
      ],
      owner,
    );
    await pawthereumBuyBackAndBurn.waitForDeployment();

    // turn taxes of for adding liquidity
    const taxesOff = await pawthereum.setTaxActive(false);
    await taxesOff.wait();

    // add liquidity
    const sendPawthToContract = await pawthereum.transfer(
      await pawthereum.getAddress(), 
      hre.ethers.parseUnits('100000000', await pawthereum.decimals()),
    );
    await sendPawthToContract.wait();
    const initLp = await pawthereum.initLp({
      value: hre.ethers.parseEther('1'),
    });
    await initLp.wait();
    // set lp tax to 200
    const setLpTax = await pawthereum.setLiquidityFee(200);
    await setLpTax.wait();

    // turn taxes back on
    const taxesOn = await pawthereum.setTaxActive(true);
    await taxesOn.wait();

  });

  // write a buy back and burn test
  describe("Buy back and burn", function () {
    it("Should buy back and burn", async function () {
      // send the contract some eth
      await owner.sendTransaction({ 
        to: await pawthereumBuyBackAndBurn.getAddress(), 
        value: hre.ethers.parseEther('0.01'),
      });
      // get the balance of the contract
      const balanceBefore = await hre.ethers.provider.getBalance(await pawthereumBuyBackAndBurn.getAddress());

      // get the balance of the burn address before
      const burnBalanceBefore = await pawthereum.balanceOf(
        await pawthereumBuyBackAndBurn.burn()
      );

      // get expected amount to be burned
      const expectedBurn = await pawthereumBuyBackAndBurn.calculateBuyBackAndBurn(
        hre.ethers.parseEther('0.01'),
        0,
      );

      // call the buy back and burn function
      const buyBackAndBurn = await pawthereumBuyBackAndBurn.buyBackAndBurn(0);
      await buyBackAndBurn.wait();

      // get the balance of the contract
      const balanceAfter = await hre.ethers.provider.getBalance(await pawthereumBuyBackAndBurn.getAddress());

      // get the balance of the burn address after
      const burnBalanceAfter = await pawthereum.balanceOf(
        await pawthereumBuyBackAndBurn.burn()
      );
      // check that the contract balance is less
      expect(balanceAfter).to.be.lt(balanceBefore);
      // check that it spent all of its balance
      expect(balanceAfter).to.be.eq(0);
      // check that the burn balance is more
      expect(burnBalanceAfter).to.be.gt(burnBalanceBefore);
      // check that it burned at least as much as expected
      expect(burnBalanceAfter).to.be.gte(expectedBurn);
    });
    it("Should only be able to rescue tokens to the multi-sig", async function () {
      // send the contract some pawth tokens
      const amountSent = hre.ethers.parseUnits('100000000', await pawthereum.decimals());
      const ninetyOnePercentOfAmountSent = BigInt(amountSent) * BigInt(91) / BigInt(100); // handle taxes
      const sendPawthToContract = await pawthereum.transfer(
        await pawthereumBuyBackAndBurn.getAddress(), 
        amountSent,
      );
      await sendPawthToContract.wait();

      // balance of owner before
      const balanceBefore = await pawthereum.balanceOf(await owner.getAddress());

      // withdraw the tokens
      const withdraw = await pawthereumBuyBackAndBurn.rescueToken(
        await pawthereum.getAddress(),
      );
      await withdraw.wait();

      // balance of owner after
      const balanceAfter = await pawthereum.balanceOf(await owner.getAddress());
      // balance of multisig after
      const multiSigBalanceAfter = await pawthereum.balanceOf(await multiSig.getAddress());
      // balance of contract after
      const contractBalanceAfter = await pawthereum.balanceOf(await pawthereumBuyBackAndBurn.getAddress());

      // check that the owner balance is the same (plus taxes)
      expect(balanceAfter).to.be.approximately(balanceBefore, ninetyOnePercentOfAmountSent);
      // check that the multisig balance is the amount sent (minus taxes)
      expect(multiSigBalanceAfter).to.be.approximately(amountSent, ninetyOnePercentOfAmountSent);
      // check that the contract balance is 0
      expect(contractBalanceAfter).to.be.eq(0);
    });

    it("Should only allow the multi-sig to rescue eth to itself", async function () {
      // send the contract some eth
      await owner.sendTransaction({ 
        to: await pawthereumBuyBackAndBurn.getAddress(), 
        value: hre.ethers.parseEther('0.01'),
      });
      // withdraw the eth
      const withdraw = await pawthereumBuyBackAndBurn.connect(multiSig).rescueEth();
      await withdraw.wait();

      // get the balance of the contract
      const balanceAfter = await hre.ethers.provider.getBalance(await pawthereumBuyBackAndBurn.getAddress());

      // check that the contract balance is 0
      expect(balanceAfter).to.be.eq(0);
    });
  });
});