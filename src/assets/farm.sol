// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transfer(address recipient, uint256 amount) external returns (bool);
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

interface IVRFCoordinatorV2 {
    function requestRandomWords(
        uint256 subscriptionId,
        bytes32 keyHash,
        uint32 callbackGasLimit,
        uint16 requestConfirmations,
        uint32 numWords
    ) external returns (uint256 requestId);
}

contract BlockchainFarm {
    address public admin;
    address public ERC20_TOKEN=0xE83606959340915fBF88633c69D206FBF40ffFFF;
    address public immutable DEAD_ADDRESS = 0x000000000000000000000000000000000000dEaD;
    
    address public vrfCoordinator;
    uint256 public subscriptionId;
    bytes32 public keyHash;
    uint32 public callbackGasLimit = 100000;
    uint16 public requestConfirmations = 3;
    uint32 public numWords = 1;

    uint256 public constant WAD = 1e18;
    uint256 public constant TIME_MULTIPLIER_WAD = 95_000_000_000_000_000;

    uint256 public burnRatio = 50;
    uint256 public poolRatio = 50;
    uint256 public drawTimeThreshold = 24 hours;

    uint256 public baseMatureTime = 6 hours;
    uint256 public levelUpFeeBase = 10000 * 10**18;
    uint256[3] public expPerSeed = [100, 500, 1000];
    uint256 public expThresholdBase = 10000;
    uint256[3] public seedPrice = [1000 * 10**18, 5000 * 10**18, 10000 * 10**18];
    uint256 public landPrice = 10000 * 10**18;

    // 管理员操作税费配置
    uint256 public adminTaxRatio = 0; 
    address public taxRecipient;

    // 单次购买土地上限
    uint256 public maxLandPerPurchase = 100; 

    // 奖池 & 开奖相关（彩票数字记录）
    uint256 public prizePool;
    uint256 public currentLotteryRound = 1;
    uint256 public lastDrawTime;
    mapping(uint256 => mapping(address => uint256)) public userLotteryCount; // 期数=>用户=>彩票数
    mapping(uint256 => mapping(uint256 => address)) public lotteryNumberToUser; // 期数=>彩票数字=>用户
    mapping(uint256 => uint256) public roundMaxLotteryNumber; // 期数=>最大彩票数字
    mapping(uint256 => bool) public roundDrawn;
    mapping(uint256 => uint256) public roundRequestId;
    mapping(uint256 => uint256) public roundWinnerRandom;
    mapping(uint256 => address[]) public roundParticipants;
    mapping(uint256 => uint256) public requestIdToRound;

    struct Land {
        uint256 landId;
        address owner;
        bool hasSeed; 
    }
    uint256 public totalLandCount;
    mapping(address => uint256[]) public userLandIds;
    mapping(uint256 => Land) public landInfo;

    // 用户数据
    struct User {
        uint256 level;
        uint256 exp;
        mapping(uint256 => PlantedSeed) plantedSeed;
        mapping(uint256 => bool) landHasSeed; 
    }
    struct PlantedSeed {
        uint8 seedType;
        uint256 plantTime;
        uint256 baseDuration;
        bool isMatured;
        bool isHarvested;
    }
    mapping(address => User) public users;

    event LandPurchased(address indexed user, uint256 count, uint256 cost, uint256[] ids);
    event LandMinted(address indexed admin, address indexed to, uint256 count, uint256[] ids);
    event SeedPurchased(address indexed user, uint8 type_, uint256 count, uint256 cost);
    event SeedPlanted(address indexed user, uint256 landId, uint8 type_, uint256 baseDuration);
    event LevelUp(address indexed user, uint256 oldLvl, uint256 newLvl, uint256 cost);
    event LotteryExchanged(address indexed user, uint256 round, uint8 type_, uint256 count, uint256[] lotteryNumbers);
    event RandomnessRequested(uint256 round, uint256 reqId);
    event LotteryDrawn(uint256 round, uint256 rand, address winner, uint256 prize, uint256 winningNumber);
    event PrizePoolWithdrawn(address indexed admin, uint256 amt);
    event TokenWithdrawn(address indexed admin, address token, uint256 amt);
    event ERC20Updated(address old, address new_);
    event AdminPlantSeed(address indexed admin, address indexed user, uint256 landId, uint8 type_);
    event AdminHarvestSeed(address indexed admin, address indexed user, uint256 landId, uint256 round, uint256 count, uint256[] lotteryNumbers, uint256 fee, uint256 tax);
    event RatioUpdated(uint256 burn, uint256 pool);
    event DrawTimeUpdated(uint256 threshold);
    event AdminTaxUpdated(uint256 newRatio, address newRecipient);
    event MaxLandPerPurchaseUpdated(uint256 newMax);

    modifier onlyAdmin() {
        require(msg.sender == admin);
        _;
    }

    modifier onlyLandOwner(uint256 _landId) {
        require(landInfo[_landId].owner == msg.sender);
        _;
    }

    constructor(
        address _vrfCoordinator,
        uint256 _subscriptionId,
        bytes32 _keyHash
    ) {
        admin = msg.sender;
        vrfCoordinator = _vrfCoordinator;
        subscriptionId = _subscriptionId;
        keyHash = _keyHash;
        lastDrawTime = block.timestamp;
        taxRecipient = admin;
    }

    // 计算指定等级对应的成熟时长系数
    function _calcTimeFactor(uint256 _level) internal pure returns (uint256) {
        uint256 factor = WAD;
        for (uint256 i = 1; i < _level; i++) {
            factor = (factor * TIME_MULTIPLIER_WAD) / WAD;
        }
        return factor;
    }

    // 计算种子当前应成熟的时间（动态，基于用户当前等级）
    function getSeedMatureTime(address _user, uint256 _landId) public view returns (uint256) {
        User storage user = users[_user];
        PlantedSeed storage seed = user.plantedSeed[_landId];
        if (!user.landHasSeed[_landId] || seed.isHarvested) return 0;
        
        uint256 level = user.level == 0 ? 1 : user.level;
        uint256 timeFactor = _calcTimeFactor(level);
        // 实际成熟时长 = 基础时长 * 时间系数 / WAD
        uint256 actualDuration = (seed.baseDuration * timeFactor) / WAD;
        return seed.plantTime + actualDuration;
    }

    // 检查种子是否已成熟（动态判断）
    function isSeedMatured(address _user, uint256 _landId) public view returns (bool) {
        uint256 matureTime = getSeedMatureTime(_user, _landId);
        return matureTime > 0 && block.timestamp >= matureTime;
    }

    function _distributeFunds(uint256 _total) internal {
        uint256 burn = (_total * burnRatio) / 100;
        uint256 pool = (_total * poolRatio) / 100;
        IERC20(ERC20_TOKEN).transfer(DEAD_ADDRESS, burn);
        prizePool += pool;
    }

    function _addParticipant(address _user, uint256 _round) internal {
        address[] storage participants = roundParticipants[_round];
        for (uint256 i = 0; i < participants.length; i++) {
            if (participants[i] == _user) return;
        }
        participants.push(_user);
    }

    function _calcAdminTax(uint256 _amount) internal view returns (uint256) {
        return (_amount * adminTaxRatio) / 100;
    }

    // ========== 土地相关 ==========
    function mintLand(address _to, uint256 _count) external onlyAdmin {
        require(_to != address(0) && _count > 0);
        require(_count <= maxLandPerPurchase, "Exceeds max land per mint");
        uint256[] memory ids = new uint256[](_count);
        for (uint256 i = 0; i < _count; i++) {
            uint256 id = ++totalLandCount;
            landInfo[id] = Land({
                landId: id,
                owner: _to,
                hasSeed: false
            });
            userLandIds[_to].push(id);
            ids[i] = id;
        }
        emit LandMinted(msg.sender, _to, _count, ids);
    }

    function purchaseLand(uint256 _count) external {
        require(_count > 0);
        require(_count <= maxLandPerPurchase, "Exceeds max land per purchase");
        uint256 cost = landPrice * _count;
        require(IERC20(ERC20_TOKEN).transferFrom(msg.sender, address(this), cost));
        _distributeFunds(cost);

        uint256[] memory ids = new uint256[](_count);
        for (uint256 i = 0; i < _count; i++) {
            uint256 id = ++totalLandCount;
            landInfo[id] = Land({
                landId: id,
                owner: msg.sender,
                hasSeed: false
            });
            userLandIds[msg.sender].push(id);
            ids[i] = id;
        }
        emit LandPurchased(msg.sender, _count, cost, ids);
    }

    // ========== 种子相关 ==========
    function purchaseSeed(uint8 _type, uint256 _count) external {
        require(_type >= 1 && _type <= 3 && _count > 0);
        uint256 price = seedPrice[_type - 1];
        uint256 cost = price * _count;
        require(IERC20(ERC20_TOKEN).transferFrom(msg.sender, address(this), cost));
        _distributeFunds(cost);
        emit SeedPurchased(msg.sender, _type, _count, cost);
    }

    function adminPurchaseAndPlantSeed(address _user, uint256 _landId, uint8 _type) external onlyAdmin {
        require(_user != address(0) && _type >= 1 && _type <= 3);
        Land storage land = landInfo[_landId];
        require(land.owner == _user);
        require(!land.hasSeed, "Land already has seed");

        uint256 seedCost = seedPrice[_type - 1];
        uint256 taxAmount = _calcAdminTax(seedCost);

        require(IERC20(ERC20_TOKEN).transferFrom(_user, address(this), seedCost), "Seed fee transfer failed");
        if (taxAmount > 0) {
            require(IERC20(ERC20_TOKEN).transferFrom(_user, taxRecipient, taxAmount), "Tax transfer failed");
        }
        _distributeFunds(seedCost);
        
        User storage user = users[_user];
        // 计算等级1的基础成熟时长（固定存储，不随等级变化）
        uint256 baseDuration = _calcTimeFactor(1) * baseMatureTime / WAD;

        user.plantedSeed[_landId] = PlantedSeed({
            seedType: _type,
            plantTime: block.timestamp,
            baseDuration: baseDuration, // 只存基础时长，不存实时成熟时间
            isMatured: false,
            isHarvested: false
        });
        land.hasSeed = true;
        user.landHasSeed[_landId] = true;

        user.exp += expPerSeed[_type - 1];
        if (user.level == 0) user.level = 1;
        
        emit AdminPlantSeed(msg.sender, _user, _landId, _type);
        emit SeedPlanted(_user, _landId, _type, baseDuration);
    }

    function plantSeed(uint256 _landId, uint8 _type) external onlyLandOwner(_landId) {
        require(_type >= 1 && _type <= 3);
        Land storage land = landInfo[_landId];
        require(!land.hasSeed, "Land already has seed");

        User storage user = users[msg.sender];
        uint256 baseDuration = _calcTimeFactor(1) * baseMatureTime / WAD;

        user.plantedSeed[_landId] = PlantedSeed({
            seedType: _type,
            plantTime: block.timestamp,
            baseDuration: baseDuration,
            isMatured: false,
            isHarvested: false
        });
        land.hasSeed = true;
        user.landHasSeed[_landId] = true;

        user.exp += expPerSeed[_type - 1];
        if (user.level == 0) user.level = 1;
        emit SeedPlanted(msg.sender, _landId, _type, baseDuration);
    }

    // ========== 收获/彩票相关 ==========
    function harvestSeed(uint256 _landId) external onlyLandOwner(_landId) {
        User storage user = users[msg.sender];
        if (user.level == 0) user.level = 1;
        
        require(user.landHasSeed[_landId], "No seed on land");
        PlantedSeed storage seed = user.plantedSeed[_landId];
        require(!seed.isHarvested, "Seed already harvested");
        require(isSeedMatured(msg.sender, _landId), "Seed not mature");

        seed.isMatured = true;
        seed.isHarvested = true;
        uint256 lotteryCount = seed.seedType == 1 ? 1 : (seed.seedType == 2 ? 5 : 10);
        
        // 生成彩票数字
        uint256[] memory lotteryNumbers = new uint256[](lotteryCount);
        for (uint256 i = 0; i < lotteryCount; i++) {
            uint256 newNumber = roundMaxLotteryNumber[currentLotteryRound] + 1;
            lotteryNumberToUser[currentLotteryRound][newNumber] = msg.sender;
            lotteryNumbers[i] = newNumber;
            roundMaxLotteryNumber[currentLotteryRound] = newNumber;
        }

        userLotteryCount[currentLotteryRound][msg.sender] += lotteryCount;
        _addParticipant(msg.sender, currentLotteryRound);

        // 移除种子
        delete user.plantedSeed[_landId];
        landInfo[_landId].hasSeed = false;
        user.landHasSeed[_landId] = false;

        emit LotteryExchanged(msg.sender, currentLotteryRound, seed.seedType, lotteryCount, lotteryNumbers);
    }

    function adminHarvestSeed(address _user, uint256 _landId) external onlyAdmin {
        require(_user != address(0));
        Land storage land = landInfo[_landId];
        require(land.owner == _user);
        require(land.hasSeed, "No seed on land");

        User storage user = users[_user];
        if (user.level == 0) user.level = 1;
        
        PlantedSeed storage seed = user.plantedSeed[_landId];
        require(!seed.isHarvested, "Seed already harvested");
        require(isSeedMatured(_user, _landId), "Seed not mature");

        seed.isMatured = true;
        seed.isHarvested = true;
        uint256 lotteryCount = seed.seedType == 1 ? 1 : (seed.seedType == 2 ? 5 : 10);
        
        uint256 totalFee = levelUpFeeBase;
        uint256 taxAmount = _calcAdminTax(totalFee);
        uint256 totalCharge = totalFee + taxAmount;
        if (totalCharge > 0) {
            require(IERC20(ERC20_TOKEN).transferFrom(_user, address(this), totalFee), "Exchange fee transfer failed");
            if (taxAmount > 0) {
                require(IERC20(ERC20_TOKEN).transferFrom(_user, taxRecipient, taxAmount), "Tax transfer failed");
            }
            _distributeFunds(totalFee);
        }
        
        // 生成彩票数字
        uint256[] memory lotteryNumbers = new uint256[](lotteryCount);
        for (uint256 i = 0; i < lotteryCount; i++) {
            uint256 newNumber = roundMaxLotteryNumber[currentLotteryRound] + 1;
            lotteryNumberToUser[currentLotteryRound][newNumber] = _user;
            lotteryNumbers[i] = newNumber;
            roundMaxLotteryNumber[currentLotteryRound] = newNumber;
        }

        userLotteryCount[currentLotteryRound][_user] += lotteryCount;
        _addParticipant(_user, currentLotteryRound);

        // 移除种子
        delete user.plantedSeed[_landId];
        land.hasSeed = false;
        user.landHasSeed[_landId] = false;

        emit AdminHarvestSeed(msg.sender, _user, _landId, currentLotteryRound, lotteryCount, lotteryNumbers, totalFee, taxAmount);
        emit LotteryExchanged(_user, currentLotteryRound, seed.seedType, lotteryCount, lotteryNumbers);
    }

    // ========== 开奖相关 ==========
    function requestLotteryDraw() external {
        require(!roundDrawn[currentLotteryRound]);
        require(block.timestamp >= lastDrawTime + drawTimeThreshold || msg.sender == admin);
        require(roundMaxLotteryNumber[currentLotteryRound] > 0, "No lotteries in round");

        uint256 reqId = IVRFCoordinatorV2(vrfCoordinator).requestRandomWords(
            subscriptionId, keyHash, callbackGasLimit, requestConfirmations, numWords
        );

        roundRequestId[currentLotteryRound] = reqId;
        requestIdToRound[reqId] = currentLotteryRound;
        emit RandomnessRequested(currentLotteryRound, reqId);
    }

    function fulfillRandomWords(uint256 reqId, uint256[] memory randWords) external {
        require(msg.sender == vrfCoordinator || msg.sender == admin);
        uint256 round = requestIdToRound[reqId];
        require(round > 0 && !roundDrawn[round]);

        uint256 rand = randWords[0];
        roundWinnerRandom[round] = rand;
        address winner = address(0);
        uint256 prize = 0;
        uint256 winningNumber = 0;
        uint256 maxNumber = roundMaxLotteryNumber[round];
        
        if (maxNumber > 0 && prizePool > 0) {
            winningNumber = rand % maxNumber + 1;
            winner = lotteryNumberToUser[round][winningNumber];
            prize = prizePool;
            
            if (winner != address(0)) {
                require(IERC20(ERC20_TOKEN).transfer(winner, prize));
                prizePool = 0;
            }
        }

        roundDrawn[round] = true;
        currentLotteryRound++;
        lastDrawTime = block.timestamp;
        emit LotteryDrawn(round, rand, winner, prize, winningNumber);
    }

    // ========== 等级升级==========
    function levelUp() external {
        User storage user = users[msg.sender];
        uint256 oldLvl = user.level == 0 ? 1 : user.level;
        uint256 newLvl = oldLvl + 1;
        require(user.exp >= expThresholdBase * oldLvl);

        uint256 fee = levelUpFeeBase;
        require(IERC20(ERC20_TOKEN).balanceOf(msg.sender) >= fee);
        require(IERC20(ERC20_TOKEN).transferFrom(msg.sender, address(this), fee));
        _distributeFunds(fee);

        user.level = newLvl;
        emit LevelUp(msg.sender, oldLvl, newLvl, fee);
    }

    function setAdminTaxConfig(uint256 _taxRatio) external onlyAdmin {
        require(_taxRatio <= 100, "Tax ratio cannot exceed 100%");
        adminTaxRatio = _taxRatio;
        emit AdminTaxUpdated(_taxRatio, admin);
    }

    function setMaxLandPerPurchase(uint256 _newMax) external onlyAdmin {
        maxLandPerPurchase = _newMax;
        emit MaxLandPerPurchaseUpdated(_newMax);
    }

    function setBurnPoolRatio(uint256 _burn, uint256 _pool) external onlyAdmin {
        require(_burn + _pool == 100);
        burnRatio = _burn;
        poolRatio = _pool;
        emit RatioUpdated(_burn, _pool);
    }

    function setDrawTimeThreshold(uint256 _threshold) external onlyAdmin {
        drawTimeThreshold = _threshold;
        emit DrawTimeUpdated(_threshold);
    }

    function setERC20Token(address _new) external onlyAdmin {
        emit ERC20Updated(ERC20_TOKEN, _new);
        ERC20_TOKEN = _new;
    }

    function setVRFParams(
        address _coord,
        uint256 _subId,
        bytes32 _hash,
        uint32 _gas,
        uint16 _conf,
        uint32 _words
    ) external onlyAdmin {
        vrfCoordinator = _coord;
        subscriptionId = _subId;
        keyHash = _hash;
        callbackGasLimit = _gas;
        requestConfirmations = _conf;
        numWords = _words;
    }

    function setBaseParams(
        uint256 _matureTime,
        uint256 _levelUpFee,
        uint256 _expThreshold,
        uint256 _landPrice
    ) external onlyAdmin {
        baseMatureTime = _matureTime;
        levelUpFeeBase = _levelUpFee;
        expThresholdBase = _expThreshold;
        landPrice = _landPrice;
    }

    function setSeedParams(uint8 _type, uint256 _exp, uint256 _price) external onlyAdmin {
        require(_type >= 1 && _type <= 3);
        expPerSeed[_type - 1] = _exp;
        seedPrice[_type - 1] = _price;
    }

    function withdrawPrizePool() external onlyAdmin {
        uint256 amt = prizePool;
        require(amt > 0);
        prizePool = 0;
        require(IERC20(ERC20_TOKEN).transfer(admin, amt));
        emit PrizePoolWithdrawn(msg.sender, amt);
    }

    function withdrawToken(address _token, uint256 _amt) external onlyAdmin {
        require(_token != address(0) && _amt <= IERC20(_token).balanceOf(address(this)));
        require(IERC20(_token).transfer(admin, _amt));
        emit TokenWithdrawn(msg.sender, _token, _amt);
    }


    function withdrawETH() external onlyAdmin {
        uint256 contractBalance = address(this).balance;
        (bool success, ) = admin.call{value: contractBalance}("");
        require(success, "ETH transfer failed");
    }

    function transferAdmin(address _new) external onlyAdmin {
        require(_new != address(0));
        admin = _new;
        taxRecipient = _new;
    }

    function getUserAllLandIds(address _user) external view returns (uint256[] memory) {
        return userLandIds[_user];
    }

    function getLandDetail(uint256 _landId) external view returns (address, bool,uint256) {
        Land storage l = landInfo[_landId];
        return (l.owner,l.hasSeed,l.landId);
    }

    function getUserInfo(address _user) external view returns (uint256, uint256, uint256) {
        User storage u = users[_user];
        return (u.level == 0 ? 1 : u.level, u.exp, userLandIds[_user].length);
    }

    function getUserPlantedSeed(address _user, uint256 _landId) external view returns (PlantedSeed memory) {
        return users[_user].plantedSeed[_landId];
    }

    function getUserLotteryCount(address _user, uint256 _round) external view returns (uint256) {
        return userLotteryCount[_round][_user];
    }

    function getLotteryOwner(uint256 _round, uint256 _number) external view returns (address) {
        return lotteryNumberToUser[_round][_number];
    }

    function getRoundMaxLotteryNumber(uint256 _round) external view returns (uint256) {
        return roundMaxLotteryNumber[_round];
    }

    function getContractTokenBalance(address _token) external view returns (uint256) {
        return IERC20(_token).balanceOf(address(this));
    }

    function getAdminConfig() external view returns (uint256, address, uint256) {
        return (adminTaxRatio, taxRecipient, maxLandPerPurchase);
    }
}