// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

contract ClawMint is ERC721, Ownable, EIP712 {
    using ECDSA for bytes32;

    address public clawBot;
    uint256 public nextTokenId;

    constructor(address _clawBot) ERC721("ClawMintToken", "CMT") EIP712("ClawMintToken", "1") {
        clawBot = _clawBot;
    }

    function setClawBot(address _newBot) external onlyOwner {
        clawBot = _newBot;
    }

    function mintWithSig(address to, bytes calldata signature) external {
        require(msg.sender == clawBot, "Only Claw bot can mint");

        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(
            keccak256("Mint(address to)"),
            to
        )));
        require(ECDSA.recover(digest, signature) == clawBot, "Invalid signature");

        _mint(to, nextTokenId);
        nextTokenId++;
    }
}
