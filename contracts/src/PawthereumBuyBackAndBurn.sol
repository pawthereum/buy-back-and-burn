// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;

contract PawthereumBuyBackAndBurn {
    address immutable public pawth;
    address immutable public weth;
    address immutable public burn;
    address immutable public pawthDevMultiSig;
    IUniswapV2Router02 immutable public pancakeswap;
    uint256 maxSlippage = 9;

    modifier onlyPawthDevMultiSig() {
        require(msg.sender == pawthDevMultiSig, "Only allowed by pawthDevMultiSig");
        _;
    }

    constructor(
        address _pawth,
        address _weth,
        address _burn,
        IUniswapV2Router02 _pancakeswap,
        address _pawthDevMultiSig
    ) {
        pawth = _pawth;
        weth = _weth;
        burn = _burn;
        pancakeswap = _pancakeswap;
        pawthDevMultiSig = _pawthDevMultiSig;
    }

    function buyBackAndBurn(uint256 slippage) external payable {
        // avoid front running
        require(slippage <= maxSlippage, "Slippage too high");
        // the buy path is WETH -> PAWTH
        address [] memory path = new address[](2);
        path[0] = weth;
        path[1] = pawth;

        // get the minimum amount of PAWTH needed to buy
        uint256 eth = msg.value + address(this).balance;
        require(eth > 0, "No ETH in swap");
        uint256 minPawth = calculateBuyBackAndBurn(eth, slippage);

        // buy PAWTH and send it to the BURN address
        pancakeswap.swapExactETHForTokens{value: eth}(minPawth, path, burn, block.timestamp);
    }

    function calculateBuyBackAndBurn(uint256 eth, uint256 slippage) public view returns (uint256) {
        // the buy path is WETH -> PAWTH
        address [] memory path = new address[](2);
        path[0] = weth;
        path[1] = pawth;

        // get the minimum amount of PAWTH needed to buy
        uint256 minPawthRaw = pancakeswap.getAmountsOut(eth, path)[1];

        // if slippage is 0, use a default maxSlippage
        if (slippage == 0) {
            slippage = maxSlippage;
        }

        // minPawth is the raw quote minus slippage
        uint256 minPawth = minPawthRaw - (minPawthRaw / slippage);

        return minPawth;
    }

    // set the max slippage allowed
    function setMaxSlippage(uint256 _maxSlippage) external onlyPawthDevMultiSig() {
        maxSlippage = _maxSlippage;
    }

    // rescue stuck tokens to the multi-sig
    function rescueToken (address token_) external {
        IERC20 token = IERC20(token_);
        token.transfer(pawthDevMultiSig, token.balanceOf(address(this)));
    }

    // rescue stuck eth to the multi-sig
    // if the buy back and burn mechanism ever stops working, the dev multi-sig can rescue the eth
    function rescueEth () external onlyPawthDevMultiSig() {
        (bool success, ) = pawthDevMultiSig.call{value: address(this).balance}("");
        require(success, "Failed to rescue ETH");
    }


    receive() external payable {}
}

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
}

interface IUniswapV2Router01 {
    function factory() external pure returns (address);
    function WETH() external pure returns (address);
}

interface IUniswapV2Router02 is IUniswapV2Router01 {
    function getAmountsIn(uint amountOut, address[] calldata path) external view returns (uint[] memory amounts);
    function getAmountIn(uint amountOut, uint reserveIn, uint reserveOut) external pure returns (uint amountIn);
    function getAmountOut(uint amountIn, uint reserveIn, uint reserveOut) external pure returns (uint amountOut);
    function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts);
    function quote(uint amountA, uint reserveA, uint reserveB) external pure returns (uint amountB);
    function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable;
}