
const TelegramBot = require('node-telegram-bot-api');
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const crypto = require('crypto');

// BOT CONFIGURATION
const BOT_TOKEN = "9137739367:AAE4yIYBG956-a2vJkjJBoixJn0FjP5ca2M";
const CHANNEL_USERNAME = "@KillerbossCrackerChannel";
const CHANNEL_LINK = "https://t.me/KillerbossCrackerChannel";
const ADMIN_USER_ID = "8370471165";

// API ENDPOINTS - Updated for Shwe Lottery
const API_ENDPOINTS = {
    "6LOTTERY": "https://api.shweshwbb.com/api/webapi/",
    "SHWE": "https://api.shweshwbb.com/api/webapi/"
};

// BET TYPES
const SIX_LOTTERY_BET_TYPES = {
    "BIG": 13,
    "SMALL": 14,
    "RED": 10,
    "GREEN": 11,
    "VIOLET": 12
};

// DATABASE SETUP
const DB_NAME = "shwe_lottery_bot.db";

// GLOBAL STORAGE
const userSessions = {};
const issueCheckers = {};
const autoBettingTasks = {};
const waitingForResults = {};
const processedIssues = {};

// MYANMAR TIME FUNCTION
const getMyanmarTime = () => {
    const now = new Date();
    const myanmarOffset = 6.5 * 60 * 60 * 1000;
    const myanmarTime = new Date(now.getTime() + myanmarOffset);

    const year = myanmarTime.getUTCFullYear();
    const month = String(myanmarTime.getUTCMonth() + 1).padStart(2, '0');
    const day = String(myanmarTime.getUTCDate()).padStart(2, '0');
    const hours = String(myanmarTime.getUTCHours()).padStart(2, '0');
    const minutes = String(myanmarTime.getUTCMinutes()).padStart(2, '0');
    const seconds = String(myanmarTime.getUTCSeconds()).padStart(2, '0');

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
};

class Database {
    constructor() {
        this.db = new sqlite3.Database(DB_NAME);
        this.initDatabase();
    }

    initDatabase() {
        // ✅ Crease mode default ကို 'loss' သို့ ပြောင်းထားပါသည်
        const tables = [
            `CREATE TABLE IF NOT EXISTS users (
                user_id INTEGER PRIMARY KEY,
                phone TEXT,
                password TEXT,
                platform TEXT DEFAULT 'SHWE',
                game_id TEXT,
                trial_start INTEGER DEFAULT 0,
                trial_expire INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS user_settings (
                user_id INTEGER PRIMARY KEY,
                bet_amount INTEGER DEFAULT 100,
                auto_login BOOLEAN DEFAULT 1,
                bet_sequence TEXT DEFAULT '100,300,700,1600,3200,7600,16000,32000',
                current_bet_index INTEGER DEFAULT 0,
                platform TEXT DEFAULT 'SHWE',
                auto_betting BOOLEAN DEFAULT 0,
                random_betting TEXT DEFAULT 'bot',
                profit_target INTEGER DEFAULT 0,
                loss_target INTEGER DEFAULT 0,
                game_type TEXT DEFAULT 'WINGO_1MIN',
                crease_mode TEXT DEFAULT 'loss',
                follow_inverse BOOLEAN DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS allowed_game_ids (
                game_id TEXT PRIMARY KEY,
                added_by INTEGER,
                added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS bet_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                platform TEXT,
                issue TEXT,
                bet_type TEXT,
                amount INTEGER,
                result TEXT,
                profit_loss INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS pending_bets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                platform TEXT,
                issue TEXT,
                bet_type TEXT,
                amount INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS bot_sessions (
                user_id INTEGER PRIMARY KEY,
                is_running BOOLEAN DEFAULT 0,
                last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                total_bets INTEGER DEFAULT 0,
                total_profit INTEGER DEFAULT 0,
                session_profit INTEGER DEFAULT 0,
                session_loss INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS formula_patterns (
                user_id INTEGER PRIMARY KEY,
                bs_pattern TEXT DEFAULT '',
                colour_pattern TEXT DEFAULT '',
                bs_current_index INTEGER DEFAULT 0,
                colour_current_index INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`
        ];

        let completed = 0;
        tables.forEach((table, index) => {
            this.db.run(table, (err) => {
                if (err) {
                    console.error('Error creating table:', err);
                } else {
                    console.log(`✅ Table ${index + 1}/${tables.length} created`);
                }
                completed++;
                if (completed === tables.length) {
                    console.log('✅ All tables created successfully');
                }
            });
        });
    }

    run(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.run(sql, params, function(err) {
                if (err) reject(err);
                else resolve({ id: this.lastID, changes: this.changes });
            });
        });
    }

    get(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.get(sql, params, (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    }

    all(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.all(sql, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }
}

class LotteryAPI {
    constructor(platform = 'SHWE', gameType = 'WINGO') {
        this.platform = platform;
        this.gameType = gameType;
        this.baseUrl = API_ENDPOINTS[platform] || "https://api.shweshwbb.com/api/webapi/";
        this.token = '';
        this.headers = {
            "Accept": "application/json, text/plain, */*",
            "Content-Type": "application/json;charset=UTF-8",
            "Origin": this.getOrigin(),
            "Referer": this.getReferer(),
            "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Mobile/22D63 Safari/604.1"
        };
    }

    getOrigin() {
        return "https://www.shweshwbb.com";
    }

    getReferer() {
        return "https://www.shweshwbb.com/";
    }

    signMd5(data) {
        const signData = { ...data };
        delete signData.signature;
        delete signData.timestamp;

        const sortedKeys = Object.keys(signData).sort();
        const sortedData = {};
        sortedKeys.forEach(key => {
            sortedData[key] = signData[key];
        });

        const hashString = JSON.stringify(sortedData).replace(/\s/g, '');
        return crypto.createHash('md5').update(hashString).digest('hex').toUpperCase();
    }

    randomKey() {
        const xxxx = "xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx";
        let result = "";

        for (let char of xxxx) {
            if (char === 'x') {
                result += '0123456789abcdef'[Math.floor(Math.random() * 16)];
            } else if (char === 'y') {
                result += '89a'[Math.floor(Math.random() * 3)];
            } else {
                result += char;
            }
        }
        return result;
    }

    async login(phone, password) {
        try {
            let formattedPhone = phone;

            if (!phone.startsWith('95')) {
                formattedPhone = '95' + phone;
            }

            formattedPhone = formattedPhone.replace(/\D/g, '');

            const body = {
                "phonetype": -1,
                "language": 0,
                "logintype": "mobile",
                "random": "9078efc98754430e92e51da59eb2563c",
                "username": formattedPhone,
                "pwd": password,
                "timestamp": Math.floor(Date.now() / 1000)
            };

            body.signature = this.signMd5(body);
            console.log('Login Request Body:', JSON.stringify(body, null, 2));

            const response = await axios.post(`${this.baseUrl}Login`, body, {
                headers: this.headers,
                timeout: 30000
            });

            console.log('Login Response:', JSON.stringify(response.data, null, 2));

            if (response.status === 200) {
                const result = response.data;
                if (result.msgCode === 0 || result.code === 0 || result.success === true) {
                    const tokenData = result.data || {};
                    this.token = `${tokenData.tokenHeader || ''}${tokenData.token || ''}`;
                    this.headers.Authorization = this.token;
                    return { success: true, message: "Login successful", token: this.token };
                } else {
                    return { 
                        success: false, 
                        message: result.msg || result.message || "Login failed", 
                        token: "" 
                    };
                }
            } else {
                return { 
                    success: false, 
                    message: `API connection failed: ${response.status}`, 
                    token: "" 
                };
            }
        } catch (error) {
            console.error('Login error details:', error);
            return { 
                success: false, 
                message: `Login error: ${error.message}`, 
                token: "" 
            };
        }
    }

    async getUserInfo() {
        try {
            const body = {
                "language": 0,
                "random": "9078efc98754430e92e51da59eb2563c",
                "timestamp": Math.floor(Date.now() / 1000)
            };
            body.signature = this.signMd5(body);

            const response = await axios.post(`${this.baseUrl}GetUserInfo`, body, {
                headers: this.headers,
                timeout: 10000
            });

            if (response.status === 200) {
                const result = response.data;
                if (result.msgCode === 0 || result.code === 0) {
                    return result.data || {};
                }
            }
            return {};
        } catch (error) {
            console.error('Error getting user info:', error.message);
            return {};
        }
    }

    async getBalance() {
        try {
            const body = {
                "language": 0,
                "random": "9078efc98754430e92e51da59eb2563c",
                "timestamp": Math.floor(Date.now() / 1000)
            };
            body.signature = this.signMd5(body);

            const response = await axios.post(`${this.baseUrl}GetBalance`, body, {
                headers: this.headers,
                timeout: 10000
            });

            if (response.status === 200) {
                const result = response.data;
                if (result.msgCode === 0 || result.code === 0) {
                    return result.data?.amount || 0;
                }
            }
            return 0;
        } catch (error) {
            console.error('Error getting balance:', error.message);
            return 0;
        }
    }

    async getCurrentIssue() {
        try {
            let typeId;
            let endpoint;

            if (this.gameType === 'TRX_1MIN') {
                typeId = 13;
                endpoint = 'GetTrxGameIssue';
            } else if (this.gameType === 'WINGO_30S') {
                typeId = 30;
                endpoint = 'GetGameIssue';
            } else {
                typeId = 1;
                endpoint = 'GetGameIssue';
            }

            const body = {
                "typeId": typeId,
                "language": 0,
                "random": "b05034ba4a2642009350ee863f29e2e9",
                "timestamp": Math.floor(Date.now() / 1000)
            };
            body.signature = this.signMd5(body);

            console.log(`GETTING CURRENT ISSUE FOR - ${this.gameType}, TYPEID: ${typeId}`);

            const response = await axios.post(`${this.baseUrl}${endpoint}`, body, {
                headers: this.headers,
                timeout: 10000
            });

            console.log(`ISSUE RESPONSE FOR ${this.gameType}:`, JSON.stringify(response.data));

            if (response.status === 200) {
                const result = response.data;

                if (result.msgCode === 0 || result.code === 0) {
                    let issueNumber = '';

                    if (this.gameType === 'TRX_1MIN') {
                        issueNumber = result.data?.predraw?.issueNumber || 
                                     result.data?.issueNumber || 
                                     result.issueNumber || '';
                    } else if (this.gameType === 'WINGO_30S') {
                        if (result.data) {
                            issueNumber = result.data.issueNumber || 
                                         result.data.predraw?.issueNumber || 
                                         result.data.current?.issueNumber || '';

                            if (!issueNumber) {
                                issueNumber = result.data.currentIssue || result.data.issue || '';
                            }
                        }
                        if (!issueNumber) {
                            issueNumber = result.issueNumber || result.issue || '';
                        }
                    } else {
                        issueNumber = result.data?.issueNumber || 
                                     result.data?.predraw?.issueNumber || 
                                     result.issueNumber || 
                                     result.data?.current?.issueNumber || '';

                        if (!issueNumber && result.data) {
                            const dataStr = JSON.stringify(result.data);
                            const issueMatch = dataStr.match(/"issueNumber"\s*:\s*"(\d+)"/);
                            if (issueMatch) {
                                issueNumber = issueMatch[1];
                            }
                        }
                    }

                    console.log(`CURRENT ISSUE FOR ${this.gameType}: ${issueNumber}`);
                    return issueNumber;
                } else {
                    console.log(`ERROR GETTING ISSUE FOR ${this.gameType}:`, result.msg);
                    return "";
                }
            } else {
                console.log(`HTTP ERROR FOR ${this.gameType}:`, response.status);
                return "";
            }
        } catch (error) {
            console.error(`ERROR GETTING CURRENT ISSUE FOR ${this.gameType}:`, error.message);
            return "";
        }
    }

    async placeBet(amount, betType) {
        try {
            console.log(`ATTEMPTING TO PLACE BET - GAME: ${this.gameType}, AMOUNT: ${amount}, BETTYPE: ${betType}`);

            if (amount < 100) {
                amount = 100;
            }

            let issueId = "";
            let retryCount = 0;
            const maxRetries = 3;

            while (!issueId && retryCount < maxRetries) {
                issueId = await this.getCurrentIssue();
                if (!issueId) {
                    retryCount++;
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }

            if (!issueId) {
                return { 
                    success: false, 
                    message: "Failed to get current issue after multiple attempts.", 
                    issueId: "", 
                    potentialProfit: 0 
                };
            }

            let requestBody;
            let baseAmount, betCount;
            let endpoint;

            if (this.gameType === 'TRX_1MIN') {
                baseAmount = 100;
                betCount = Math.floor(amount / baseAmount);
                if (betCount < 1) betCount = 1;

                const actualAmount = baseAmount * betCount;
                amount = actualAmount;

                let selectType;
                let gameTypeForTrx;
                
                if (betType === 13) {
                    selectType = 13;
                    gameTypeForTrx = 2;
                } else if (betType === 14) {
                    selectType = 14;
                    gameTypeForTrx = 2;
                } else if (betType === 10) {
                    selectType = 10;
                    gameTypeForTrx = 0;
                } else if (betType === 11) {
                    selectType = 11;
                    gameTypeForTrx = 0;
                } else if (betType === 12) {
                    selectType = 12;
                    gameTypeForTrx = 0;
                } else {
                    selectType = 13;
                    gameTypeForTrx = 2;
                }

                requestBody = {
                    "typeId": 13,
                    "issuenumber": issueId,
                    "language": 0,
                    "gameType": gameTypeForTrx,
                    "amount": baseAmount,
                    "betCount": betCount,
                    "selectType": selectType,
                    "random": this.randomKey(),
                    "timestamp": Math.floor(Date.now() / 1000)
                };

                endpoint = 'GameTRXBetting';
            } else {
                baseAmount = amount >= 10000 ? 1000 : 100;
                betCount = Math.floor(amount / baseAmount);
                if (betCount < 1) betCount = 1;

                const actualAmount = baseAmount * betCount;
                amount = actualAmount;

                const isColourBet = [10, 11, 12].includes(betType);
                let typeId = this.gameType === 'WINGO_30S' ? 30 : 1;
                let gameType = isColourBet ? 0 : 2;

                requestBody = {
                    "typeId": typeId,
                    "issuenumber": issueId,
                    "language": 0,
                    "gameType": gameType,
                    "amount": baseAmount,
                    "betCount": betCount,
                    "selectType": betType,
                    "random": this.randomKey(),
                    "timestamp": Math.floor(Date.now() / 1000)
                };

                endpoint = 'GameBetting';
            }

            requestBody.signature = this.signMd5(requestBody);

            const response = await axios.post(`${this.baseUrl}${endpoint}`, requestBody, {
                headers: this.headers,
                timeout: 15000
            });

            if (response.status === 200) {
                const result = response.data;
                if (result.code === 0 || result.msgCode === 0 || result.success === true) {
                    const contractAmount = Math.floor(amount * 0.98);
                    const potentialProfit = contractAmount * 2;

                    return { 
                        success: true, 
                        message: "Bet placed successfully", 
                        issueId, 
                        potentialProfit, 
                        actualAmount: amount,
                        contractAmount
                    };
                } else {
                    return { 
                        success: false, 
                        message: result.msg || result.message || 'Bet failed', 
                        issueId, 
                        potentialProfit: 0 
                    };
                }
            } else {
                return { 
                    success: false, 
                    message: `API connection failed: ${response.status}`, 
                    issueId, 
                    potentialProfit: 0 
                };
            }
        } catch (error) {
            console.log('BETTING ERROR:', error.message);
            return { 
                success: false, 
                message: `Betting error: ${error.message}`, 
                issueId: "", 
                potentialProfit: 0 
            };
        }
    }

    async getRecentResults(count = 10) {
        try {
            if (this.gameType === 'TRX_1MIN') {
                const body = {
                    "typeId": 13,
                    "language": 0,
                    "random": "b05034ba4a2642009350ee863f29e2e9",
                    "timestamp": Math.floor(Date.now() / 1000)
                };
                body.signature = this.signMd5(body);

                const response = await axios.post(`${this.baseUrl}GetTRXNoaverageEmerdList`, body, {
                    headers: this.headers,
                    timeout: 10000
                });

                if (response.status === 200) {
                    const result = response.data;
                    if (result.msgCode === 0 || result.code === 0) {
                        let gamesList = result.data?.data?.gamesList || 
                                       result.data?.data?.gameslist || 
                                       result.data?.gamesList || 
                                       result.data?.gameslist || [];

                        if (gamesList.length > 0) {
                            return gamesList.slice(0, count).map(game => {
                                const number = String(game.number || '');
                                let colour = (game.colour || '').toUpperCase();
                                if (!['GREEN', 'RED', 'VIOLET'].includes(colour)) {
                                    if (['0', '5'].includes(number)) colour = 'VIOLET';
                                    else if (['1', '3', '7', '9'].includes(number)) colour = 'GREEN';
                                    else if (['2', '4', '6', '8'].includes(number)) colour = 'RED';
                                    else colour = 'UNKNOWN';
                                }
                                return { issueNumber: game.issueNumber, number, colour };
                            });
                        }
                    }
                }
                return [];
            } else {
                const typeId = this.gameType === 'WINGO_30S' ? 30 : 1;
                const body = {
                    "pageNo": 1,
                    "pageSize": count,
                    "language": 0,
                    "typeId": typeId,
                    "random": "6DEB0766860C42151A193692ED16D65A",
                    "timestamp": Math.floor(Date.now() / 1000)
                };
                body.signature = this.signMd5(body);

                const response = await axios.post(`${this.baseUrl}GetNoaverageEmerdList`, body, {
                    headers: this.headers,
                    timeout: 10000
                });

                if (response.status === 200) {
                    const result = response.data;
                    if (result.msgCode === 0 || result.code === 0) {
                        const dataStr = JSON.stringify(response.data);
                        const startIdx = dataStr.indexOf('[');
                        const endIdx = dataStr.indexOf(']') + 1;

                        if (startIdx !== -1 && endIdx !== -1) {
                            const results = JSON.parse(dataStr.substring(startIdx, endIdx));
                            results.forEach(item => {
                                const number = String(item.number || '');
                                if (['0', '5'].includes(number)) item.colour = 'VIOLET';
                                else if (['1', '3', '7', '9'].includes(number)) item.colour = 'GREEN';
                                else if (['2', '4', '6', '8'].includes(number)) item.colour = 'RED';
                                else item.colour = 'UNKNOWN';
                            });
                            return results;
                        }
                    }
                }
                return [];
            }
        } catch (error) {
            console.error('Error getting recent results:', error.message);
            return [];
        }
    }
}

class AutoLotteryBot {
    constructor() {
        this.bot = new TelegramBot(BOT_TOKEN, { polling: true });
        this.db = new Database();
        this.setupHandlers();
        console.log("Auto Bot initialized successfully!");
    }

    maskPhoneNumber(phone) {
        if (!phone) return 'N/A';
        const cleanPhone = phone.replace(/\D/g, '');
        if (cleanPhone.length < 6) return phone;
        const firstThree = cleanPhone.substring(0, 3);
        const lastTwo = cleanPhone.substring(cleanPhone.length - 2);
        const mask = '*'.repeat(cleanPhone.length - 5);
        return `${firstThree}${mask}${lastTwo}`;
    }

    setupHandlers() {
        this.bot.onText(/\/start/, (msg) => this.handleStart(msg));
        this.bot.onText(/\/aid (.+)/, (msg, match) => this.handleAddGameId(msg, match));
        this.bot.onText(/\/rid (.+)/, (msg, match) => this.handleRemoveGameId(msg, match));
        this.bot.onText(/\/ids/, (msg) => this.handleListGameIds(msg));
        this.bot.onText(/\/gats/, (msg) => this.handleGameIdStats(msg));
        this.bot.onText(/\/broadcast (.+)/, (msg, match) => this.handleBroadcastMessage(msg, match));
        this.bot.onText(/\/msg (.+)/, (msg, match) => this.handleBroadcastActive(msg, match));

        this.bot.on('callback_query', (query) => this.handleCallbackQuery(query));

        this.bot.on('message', (msg) => {
            if (msg.text && !msg.text.startsWith('/')) {
                this.handleMessage(msg);
            }
        });

        this.bot.on('polling_error', (error) => {
            console.error('Bot Polling error:', error);
        });
    }

    ensureUserSession(userId) {
        if (!userSessions[userId]) {
            userSessions[userId] = {
                step: 'main',
                phone: '',
                password: '',
                platform: 'SHWE',
                gameType: 'WINGO_30S',
                loggedIn: false,
                apiInstance: null
            };
        }
        return userSessions[userId];
    }

    getMainKeyboard(userId = null) {
        return {
            keyboard: [
                [{ text: "Login" }],
                [{ text: "Balance" }, { text: "Results" }],
                [{ text: "Bet BIG" }, { text: "Bet SMALL" }],
                [{ text: "Bet RED" }, { text: "Bet GREEN" }, { text: "Bet VIOLET" }],
                [{ text: "Bot Settings" }, { text: "My Bets" }],
                [{ text: "Bot Info" }, { text: "Game Type" }],
                [{ text: "Crease Mode" }],
                [{ text: "Run Bot" }, { text: "Stop Bot" }]
            ],
            resize_keyboard: true
        };
    }

    getCreaseModeKeyboard() {
        return {
            keyboard: [
                [{ text: "Loss Crease" }, { text: "Win Crease" }],
                [{ text: "Main Menu" }]
            ],
            resize_keyboard: true
        };
    }

    getFollowInverseKeyboard() {
        return {
            keyboard: [
                [{ text: "Enable Inverse" }, { text: "Disable Inverse" }],
                [{ text: "Main Menu" }]
            ],
            resize_keyboard: true
        };
    }

    getBotSettingsKeyboard() {
        return {
            keyboard: [
                [{ text: "Random BIG" }, { text: "Random SMALL" }],
                [{ text: "Random Bot" }, { text: "Follow Bot" }],
                [{ text: "Follow Inverse" }],
                [{ text: "Set Bet Sequence" }],
                [{ text: "BS Formula" }, { text: "Colour Formula" }],
                [{ text: "Profit Target" }, { text: "Loss Target" }],
                [{ text: "Main Menu" }]
            ],
            resize_keyboard: true
        };
    }

    getLoginKeyboard() {
        return {
            keyboard: [
                [{ text: "Enter Phone" }, { text: "Enter Password" }],
                [{ text: "Login Now" },  { text: "Back" }]
            ],
            resize_keyboard: true
        };
    }

    getGameTypeKeyboard() {
        return {
            keyboard: [
                [{ text: "WINGO 30S" }],
                [{ text: "WINGO 1 MIN" }],
                [{ text: "TRX 1 MIN" }],
                [{ text: "Back" }]
            ],
            resize_keyboard: true
        };
    }

    getBsPatternKeyboard() {
        return {
            keyboard: [
                [{ text: "Set BS Pattern" }, { text: "View BS Pattern" }],
                [{ text: "Clear BS Pattern" }, { text: "Bot Settings" }]
            ],
            resize_keyboard: true
        };
    }

    getColourPatternKeyboard() {
        return {
            keyboard: [
                [{ text: "Set Colour Pattern" }, { text: "View Colour Pattern" }],
                [{ text: "Clear Colour Pattern" }, { text: "Bot Settings" }]
            ],
            resize_keyboard: true
        };
    }

    async getColourFormulaBetType(userId) {
        try {
            const patternsData = await this.getFormulaPatterns(userId);
            const colourPattern = patternsData.colour_pattern;
            let currentIndex = patternsData.colour_current_index;

            if (!colourPattern) {
                const betType = Math.random() < 0.5 ? 13 : 14;
                return { betType, betTypeStr: betType === 13 ? "BIG (Random Fallback)" : "SMALL (Random Fallback)" };
            }

            const patternArray = colourPattern.split(',');
            if (currentIndex >= patternArray.length) {
                currentIndex = 0;
            }

            const currentBet = patternArray[currentIndex];
            let betType;
            let betTypeStr;

            switch(currentBet) {
                case 'G':
                    betType = 11;
                    betTypeStr = "GREEN";
                    break;
                case 'R':
                    betType = 10;
                    betTypeStr = "RED";
                    break;
                case 'V':
                    betType = 12;
                    betTypeStr = "VIOLET";
                    break;
                default:
                    betType = Math.random() < 0.5 ? 13 : 14;
                    betTypeStr = betType === 13 ? "BIG" : "SMALL";
            }

            const fullBetTypeStr = `${betTypeStr} (Colour Formula ${currentIndex + 1}/${patternArray.length})`;
            await this.updateColourPatternIndex(userId, currentIndex + 1);

            return { betType, betTypeStr: fullBetTypeStr };
        } catch (error) {
            console.error(`Error getting Colour formula bet type:`, error);
            const betType = Math.random() < 0.5 ? 13 : 14;
            return { betType, betTypeStr: betType === 13 ? "BIG" : "SMALL" };
        }
    }

    async updateColourPatternIndex(userId, newIndex) {
        try {
            await this.db.run(
                'UPDATE formula_patterns SET colour_current_index = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
                [newIndex, userId]
            );
            return true;
        } catch (error) {
            return false;
        }
    }

    async showCreaseModeMenu(chatId, userId) {
        try {
            // Default ကို 'loss' အဖြစ် သတ်မှတ်ထားပါသည်
            const creaseMode = await this.getUserSetting(userId, 'crease_mode', 'loss');
            const statusText = creaseMode === 'win' ? "Win Crease" : "Loss Crease";
            
            const menuText = `Choose Select Crease (Current: ${statusText}):`;
            
            await this.bot.sendMessage(chatId, menuText, {
                reply_markup: this.getCreaseModeKeyboard()
            });
        } catch (error) {
            console.error(`Error showing crease mode menu:`, error);
            await this.bot.sendMessage(chatId, "Error loading crease mode menu. Please try again.");
        }
    }

    async setCreaseMode(chatId, userId, mode) {
        try {
            await this.saveUserSetting(userId, 'crease_mode', mode);
            const message = mode === 'win' ? "Crease Mode Set to: Win Crease" : "Crease Mode Set to: Loss Crease";
            
            const userSession = this.ensureUserSession(userId);
            userSession.step = 'main';
            
            await this.bot.sendMessage(chatId, message, {
                reply_markup: this.getMainKeyboard(userId)
            });
        } catch (error) {
            console.error(`Error setting crease mode:`, error);
            await this.bot.sendMessage(chatId, "Error setting crease mode. Please try again.");
        }
    }

    async setFollowInverse(chatId, userId, enabled) {
        try {
            await this.saveUserSetting(userId, 'follow_inverse', enabled ? 1 : 0);
            if (enabled) {
                await this.clearFormulaPatterns(userId);
            }
            const statusText = enabled ? "✅ Enabled" : "❌ Disabled";
            const message = `Follow Inverse Mode: ${statusText}\n\n${enabled ? 'Bot will bet the opposite of the last result' : 'Follow Inverse is disabled'}`;
            await this.bot.sendMessage(chatId, message);
        } catch (error) {
            await this.bot.sendMessage(chatId, "Error setting follow inverse mode. Please try again.");
        }
    }

    async getFollowInverseBetType(apiInstance) {
        try {
            const results = await apiInstance.getRecentResults(1);
            if (!results || results.length === 0) {
                const betType = Math.random() < 0.5 ? 13 : 14;
                return { betType, betTypeStr: betType === 13 ? "BIG (Random Fallback)" : "SMALL (Random Fallback)" };
            }

            const lastResult = results[0];
            const number = lastResult.number || '';
            const lastResultType = ['0','1','2','3','4'].includes(number) ? "SMALL" : "BIG";
            
            const betType = lastResultType === "SMALL" ? 13 : 14;
            const betTypeStr = `${lastResultType === "SMALL" ? "BIG" : "SMALL"} (Inverse of ${lastResultType})`;
            return { betType, betTypeStr };
        } catch (error) {
            const betType = Math.random() < 0.5 ? 13 : 14;
            return { betType, betTypeStr: betType === 13 ? "BIG" : "SMALL" };
        }
    }

    async getBsFormulaBetType(userId) {
        try {
            const patternsData = await this.getFormulaPatterns(userId);
            const bsPattern = patternsData.bs_pattern;
            let currentIndex = patternsData.bs_current_index;

            if (!bsPattern) {
                const betType = Math.random() < 0.5 ? 13 : 14;
                return { betType, betTypeStr: betType === 13 ? "BIG (Random Fallback)" : "SMALL (Random Fallback)" };
            }

            const patternArray = bsPattern.split(',');
            if (currentIndex >= patternArray.length) {
                currentIndex = 0;
            }

            const currentBet = patternArray[currentIndex];
            const betType = currentBet === 'B' ? 13 : 14;
            const betTypeStr = `${currentBet === 'B' ? 'BIG' : 'SMALL'} (BS Formula ${currentIndex + 1}/${patternArray.length})`;

            await this.updateBsPatternIndex(userId, currentIndex + 1);
            return { betType, betTypeStr };
        } catch (error) {
            const betType = Math.random() < 0.5 ? 13 : 14;
            return { betType, betTypeStr: betType === 13 ? "BIG" : "SMALL" };
        }
    }

    async updateBsPatternIndex(userId, newIndex) {
        try {
            await this.db.run(
                'UPDATE formula_patterns SET bs_current_index = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
                [newIndex, userId]
            );
            return true;
        } catch (error) {
            return false;
        }
    }

    async handleStart(msg) {
        const chatId = msg.chat.id;
        const userId = String(chatId);
        this.ensureUserSession(userId);
        const welcomeText = `Welcome ${msg.from.first_name} to Shwe Lottery Auto Bot!`;

        await this.bot.sendMessage(chatId, welcomeText, {
            reply_markup: this.getMainKeyboard()
        });
    }

    async handleCallbackQuery(query) {
        const chatId = query.message.chat.id;
        if (query.data === "check_join") {
            await this.bot.answerCallbackQuery(query.id);
            await this.bot.editMessageText("Thank you for joining our channel! You can now use the bot.\n\nPress /start to begin.", {
                chat_id: chatId,
                message_id: query.message.message_id
            });
        }
    }

    async handleMessage(msg) {
        if (!msg.text) return;

        const chatId = msg.chat.id;
        const userId = String(chatId);
        const text = msg.text;
        const userSession = this.ensureUserSession(userId);

        switch (userSession.step) {
            case 'login_phone':
                userSession.phone = text;
                userSession.step = 'login';
                await this.bot.sendMessage(chatId, `Phone number saved: ${text}\nNow please enter your password:`, {
                    reply_markup: this.getLoginKeyboard()
                });
                break;

            case 'login_password':
                userSession.password = text;
                userSession.step = 'login';
                await this.bot.sendMessage(chatId, "Password saved!\nClick 'Login Now' to authenticate.", {
                    reply_markup: this.getLoginKeyboard()
                });
                break;

            case 'set_game_type':
                await this.handleSetGameType(chatId, userId, text);
                break;

            case 'set_bet_sequence':
                await this.handleSetBetSequence(chatId, userId, text);
                break;

            case 'set_profit_target':
                await this.handleSetProfitTarget(chatId, userId, text);
                break;

            case 'set_loss_target':
                await this.handleSetLossTarget(chatId, userId, text);
                break;

            case 'set_bs_pattern':
                await this.handleSetBsPattern(chatId, userId, text);
                break;

            case 'set_colour_pattern':
                await this.handleSetColourPattern(chatId, userId, text);
                break;

            default:
                await this.handleButtonCommand(chatId, userId, text);
        }
    }

    async handleButtonCommand(chatId, userId, text) {
        try {
            const userSession = this.ensureUserSession(userId);

            const protectedCommands = [
                "Balance", "Results", "Bet BIG", "Bet SMALL", "Bet RED", 
                "Bet GREEN", "Bet VIOLET", "Bot Settings", "My Bets", 
                "Run Bot", "Bot Info", "Crease Mode", "Game Type", "Stop Bot",
                "Follow Inverse"
            ];

            if (protectedCommands.includes(text) && !userSession.loggedIn) {
                await this.bot.sendMessage(chatId, "Please login to Shwe Lottery first!");
                return;
            }

            switch (text) {
                case "Login":
                    await this.handleLoginPlatform(chatId, userId);
                    break;
                case "Balance":
                    await this.handleBalance(chatId, userId);
                    break;
                case "Results":
                    await this.handleResults(chatId, userId);
                    break;
                case "Bet BIG":
                    await this.placeBetHandler(chatId, userId, 13);
                    break;
                case "Bet SMALL":
                    await this.placeBetHandler(chatId, userId, 14);
                    break;
                case "Bet RED":
                    await this.placeColourBet(chatId, userId, "RED");
                    break;
                case "Bet GREEN":
                    await this.placeColourBet(chatId, userId, "GREEN");
                    break;
                case "Bet VIOLET":
                    await this.placeColourBet(chatId, userId, "VIOLET");
                    break;
                case "Bot Settings":
                    await this.showBotSettings(chatId, userId);
                    break;
                case "My Bets":
                    await this.showMyBets(chatId, userId);
                    break;
                case "Game Type":
                    await this.showPlatformMenu(chatId, userId);
                    break;
                case "Run Bot":
                    await this.runBot(chatId, userId);
                    break;
                case "Stop Bot":
                    await this.stopBot(chatId, userId);
                    break;
                case "Bot Info":
                    await this.showBotInfo(chatId, userId);
                    break;
                case "Enter Phone":
                    userSession.step = 'login_phone';
                    await this.bot.sendMessage(chatId, "Please enter your phone number (without country code):");
                    break;
                case "Enter Password":
                    userSession.step = 'login_password';
                    await this.bot.sendMessage(chatId, "Please enter your password:");
                    break;
                case "Login Now":
                    await this.processLogin(chatId, userId);
                    break;
                case "Back":
                case "Main Menu":
                    userSession.step = 'main';
                    await this.bot.sendMessage(chatId, "Main Menu", {
                        reply_markup: this.getMainKeyboard()
                    });
                    break;
                case "Random BIG":
                    await this.setRandomBig(chatId, userId);
                    break;
                case "Random SMALL":
                    await this.setRandomSmall(chatId, userId);
                    break;
                case "Random Bot":
                    await this.setRandomBot(chatId, userId);
                    break;
                case "Follow Bot":
                    await this.setFollowBot(chatId, userId);
                    break;
                case "Follow Inverse":
                    const currentInverse = await this.getUserSetting(userId, 'follow_inverse', 0);
                    await this.setFollowInverse(chatId, userId, !currentInverse);
                    break;
                case "Enable Inverse":
                    await this.setFollowInverse(chatId, userId, true);
                    break;
                case "Disable Inverse":
                    await this.setFollowInverse(chatId, userId, false);
                    break;
                case "BS Formula":
                    await this.showBsFormula(chatId, userId);
                    break;
                case "Colour Formula":
                    await this.showColourFormula(chatId, userId);
                    break;
                case "Set Bet Sequence":
                    userSession.step = 'set_bet_sequence';
                    const currentSequence = await this.getUserSetting(userId, 'bet_sequence', '');
                    await this.bot.sendMessage(chatId, `Current bet sequence: ${currentSequence}\nEnter new bet sequence (comma separated e.g., 100,300,700):`);
                    break;
                case "Profit Target":
                    userSession.step = 'set_profit_target';
                    const currentProfitTarget = await this.getUserSetting(userId, 'profit_target', 0);
                    await this.bot.sendMessage(chatId, `Set Profit Target\n\nCurrent target: ${currentProfitTarget.toLocaleString()} K\n\nPlease enter the profit target amount:\nExample: 10000\nEnter 0 to disable.`);
                    break;
                case "Loss Target":
                    userSession.step = 'set_loss_target';
                    const currentLossTarget = await this.getUserSetting(userId, 'loss_target', 0);
                    await this.bot.sendMessage(chatId, `Set Loss Target\n\nCurrent target: ${currentLossTarget.toLocaleString()} K\n\nPlease enter the loss target amount:\nExample: 5000\nEnter 0 to disable.`);
                    break;
                case "Set BS Pattern":
                    userSession.step = 'set_bs_pattern';
                    await this.bot.sendMessage(chatId, "Set BS Pattern (e.g. B,S,B,B):");
                    break;
                case "View BS Pattern":
                    await this.viewBsPattern(chatId, userId);
                    break;
                case "Clear BS Pattern":
                    await this.clearBsPattern(chatId, userId);
                    break;
                case "Set Colour Pattern":
                    userSession.step = 'set_colour_pattern';
                    await this.bot.sendMessage(chatId, "Set Colour Pattern (e.g. R,G,V,R):");
                    break;
                case "View Colour Pattern":
                    await this.viewColourPattern(chatId, userId);
                    break;
                case "Clear Colour Pattern":
                    await this.clearColourPattern(chatId, userId);
                    break;
                case "WINGO 1 MIN":
                case "WINGO 30S":
                case "TRX 1 MIN":
                    await this.handleSetGameType(chatId, userId, text);
                    break;
                case "Crease Mode":
                    await this.showCreaseModeMenu(chatId, userId);
                    break;
                case "Loss Crease":
                    await this.setCreaseMode(chatId, userId, 'loss');
                    break;
                case "Win Crease":
                    await this.setCreaseMode(chatId, userId, 'win');
                    break;
                default:
                    await this.bot.sendMessage(chatId, "Please use the buttons below to navigate.", {
                        reply_markup: this.getMainKeyboard()
                    });
            }
        } catch (error) {
            console.error(`Error handling button command:`, error);
            await this.bot.sendMessage(chatId, "Error processing command. Please try again.");
        }
    }

    async showPlatformMenu(chatId, userId) {
        await this.bot.sendMessage(chatId, `Select Game Type for Shwe Lottery:`, {
            reply_markup: {
                keyboard: [
                    [{ text: "WINGO 1 MIN" }],
                    [{ text: "WINGO 30S" }],
                    [{ text: "TRX 1 MIN" }],
                    [{ text: "Back" }]
                ],
                resize_keyboard: true
            }
        });
    }

    async handleSetGameType(chatId, userId, text) {
        try {
            const userSession = this.ensureUserSession(userId);
            let gameType = text.toUpperCase();

            if (text === "WINGO 1 MIN") gameType = "WINGO_1MIN";
            else if (text === "WINGO 30S") gameType = "WINGO_30S";
            else if (text === "TRX 1 MIN") gameType = "TRX_1MIN";

            if (['WINGO_1MIN', 'WINGO_30S', 'TRX_1MIN'].includes(gameType)) {
                userSession.gameType = gameType;
                await this.saveUserSetting(userId, 'game_type', gameType);

                if (userSession.apiInstance) {
                    userSession.apiInstance.gameType = gameType;
                }

                userSession.step = 'main';
                await this.bot.sendMessage(chatId, `Game type set to: ${text}`, {
                    reply_markup: this.getMainKeyboard(userId)
                });
            }
        } catch (error) {
            await this.bot.sendMessage(chatId, "Error setting game type. Please try again.");
        }
    }

    async handleLoginPlatform(chatId, userId) {
        const userSession = this.ensureUserSession(userId);
        userSession.step = 'login';
        userSession.apiInstance = new LotteryAPI('SHWE', userSession.gameType);

        const loginGuide = `Shwe Lottery Login

Please follow these steps:
1. Click 'Enter Phone' and send your phone number
2. Click 'Enter Password' and send your password  
3. Click 'Login Now' to authenticate`;

        await this.bot.sendMessage(chatId, loginGuide, {
            reply_markup: this.getLoginKeyboard()
        });
    }

    async processLogin(chatId, userId) {
        const userSession = this.ensureUserSession(userId);

        if (!userSession.phone || !userSession.password) {
            await this.bot.sendMessage(chatId, "Please enter phone number and password first!", {
                reply_markup: this.getLoginKeyboard()
            });
            return;
        }

        const loadingMsg = await this.bot.sendMessage(chatId, "Logging into Shwe Lottery... Please wait.");

        try {
            const result = await userSession.apiInstance.login(userSession.phone, userSession.password);

            if (!result.success) {
                await this.bot.editMessageText(`Login failed!\n\n${result.message}`, {
                    chat_id: chatId,
                    message_id: loadingMsg.message_id
                });
                return;
            }

            const userInfo = await userSession.apiInstance.getUserInfo();
            const gameId = String(userInfo.userId || "").trim();

            if (!gameId || gameId === '0' || gameId === 'null') {
                await this.bot.editMessageText(`Login Failed!\n\nInvalid Game ID received. Please try again.`, {
                    chat_id: chatId,
                    message_id: loadingMsg.message_id
                });
                return;
            }

            const now = Date.now();
            const existingUser = await this.db.get("SELECT user_id, game_id, trial_start, trial_expire FROM users WHERE user_id = ?", [userId]);

            if (existingUser) {
                await this.db.run(`UPDATE users SET phone = ?, password = ?, platform = 'SHWE', game_id = ? WHERE user_id = ?`,
                    [userSession.phone, userSession.password, gameId, userId]);
            } else {
                await this.db.run(`INSERT INTO users (user_id, phone, password, platform, game_id) VALUES (?, ?, ?, 'SHWE', ?)`,
                    [userId, userSession.phone, userSession.password, gameId]);
            }

            const isPremium = await this.isGameIdAllowed(gameId);

            if (isPremium) {
                await this.db.run(`UPDATE users SET trial_start = 0, trial_expire = 0 WHERE user_id = ?`, [userId]);
                await this.bot.sendMessage(ADMIN_USER_ID, `⭐ **PREMIUM USER LOGIN**\n\nUser ID: ${userId}\nGame ID: ${gameId}\nPlatform: Shwe Lottery\nTime: ${getMyanmarTime()}`);
            } else {
                const gameTrial = await this.db.get("SELECT user_id, trial_start, trial_expire FROM users WHERE game_id = ? AND trial_start > 0", [gameId]);
                if (gameTrial) {
                    if (Date.now() < gameTrial.trial_expire) {
                        if (gameTrial.user_id != userId) {
                            await this.bot.editMessageText(`Login Failed!\n\nGame ID: ${gameId}\nStatus: ALREADY REGISTERED WITH ANOTHER USER.`, {
                                chat_id: chatId,
                                message_id: loadingMsg.message_id
                            });
                            return;
                        }
                    } else {
                        await this.bot.editMessageText(`Login Failed!\n\nGame ID: ${gameId}\nStatus: TRIAL EXPIRED. Contact Admin.`, {
                            chat_id: chatId,
                            message_id: loadingMsg.message_id
                        });
                        return;
                    }
                } else {
                    await this.db.run(`UPDATE users SET trial_start = ?, trial_expire = ? WHERE user_id = ?`, [now, now + (24 * 60 * 60 * 1000), userId]);
                    await this.bot.sendMessage(chatId, "🎁 New Game ID\n\n24 Hour Free Trial Activated!");
                }
            }

            userSession.loggedIn = true;
            userSession.step = "main";

            const balance = await userSession.apiInstance.getBalance();
            const gameType = userSession.gameType || "WINGO_30S";

            await this.saveUserSetting(userId, "auto_login", 1);
            await this.saveUserSetting(userId, "game_type", gameType);

            const maskedPhone = this.maskPhoneNumber(userSession.phone);
            const successText = `Shwe Lottery Login Successful!\n\nGame ID : ${gameId}\nAccount : ${maskedPhone}\nBalance : ${balance.toLocaleString()} K\nGame Type : ${gameType}\nStatus : ${isPremium ? '⭐ PREMIUM' : 'VERIFIED ✅'}`;

            await this.bot.editMessageText(successText, {
                chat_id: chatId,
                message_id: loadingMsg.message_id
            });

            await this.bot.sendMessage(chatId, "Choose an option:", {
                reply_markup: this.getMainKeyboard()
            });

        } catch (error) {
            await this.bot.editMessageText(`Login Error!\n\n${error.message}`, {
                chat_id: chatId,
                message_id: loadingMsg.message_id
            });
        }
    }

    async handleBalance(chatId, userId) {
        const userSession = this.ensureUserSession(userId);
        if (!userSession.loggedIn) {
            await this.bot.sendMessage(chatId, "Please login to Shwe Lottery first!");
            return;
        }

        try {
            const balance = await userSession.apiInstance.getBalance();
            const userInfo = await userSession.apiInstance.getUserInfo();
            const balanceText = `Shwe Lottery Account Information\n\nGame Type: ${userSession.gameType}\nUser ID: ${userInfo.userId || 'N/A'}\nBalance: ${balance.toLocaleString()} K\nStatus: LOGGED IN ✅\nLast update: ${getMyanmarTime()}`;
            await this.bot.sendMessage(chatId, balanceText);
        } catch (error) {
            await this.bot.sendMessage(chatId, `Error getting balance: ${error.message}`);
        }
    }

    async handleResults(chatId, userId) {
        const userSession = this.ensureUserSession(userId);
        const gameType = userSession.gameType || 'WINGO_30S';

        try {
            const api = userSession.apiInstance || new LotteryAPI('SHWE', gameType);
            const results = await api.getRecentResults(10);

            if (!results || results.length === 0) {
                await this.bot.sendMessage(chatId, "No recent results available from Shwe Lottery.");
                return;
            }

            let resultsText = `Recent Shwe Lottery Results (${gameType})\n\n`;
            results.forEach((result, i) => {
                const issueNo = result.issueNumber || 'N/A';
                const number = result.number || 'N/A';
                const resultType = ['0','1','2','3','4'].includes(number) ? "SMALL" : "BIG";
                const colour = result.colour || 'UNKNOWN';
                resultsText += `${i+1}. ${issueNo} - ${number} - ${resultType} ${colour}\n`;
            });

            await this.bot.sendMessage(chatId, resultsText);
        } catch (error) {
            await this.bot.sendMessage(chatId, `Error getting results: ${error.message}`);
        }
    }

    async placeBetHandler(chatId, userId, betType) {
        const userSession = this.ensureUserSession(userId);
        if (!userSession.loggedIn) {
            await this.bot.sendMessage(chatId, "Please login to Shwe Lottery first!");
            return;
        }

        try {
            const currentIssue = await userSession.apiInstance.getCurrentIssue();
            if (!currentIssue) {
                await this.bot.sendMessage(chatId, "Cannot get current game issue. Please try again.");
                return;
            }

            if (await this.hasUserBetOnIssue(userId, userSession.platform, currentIssue)) {
                await this.bot.sendMessage(chatId, `Wait for next period\n\nYou have already placed a bet on issue ${currentIssue}.`);
                return;
            }

            let amount = await this.getCurrentBetAmount(userId);
            const betTypeStr = betType === 13 ? "BIG" : "SMALL";

            const balance = await userSession.apiInstance.getBalance();
            if (balance < amount) {
                await this.bot.sendMessage(chatId, `Insufficient balance! You have ${balance.toLocaleString()} K but need ${amount.toLocaleString()} K`);
                return;
            }

            const loadingMsg = await this.bot.sendMessage(chatId, `Placing ${betTypeStr} Bet on Shwe Lottery...`);
            const result = await userSession.apiInstance.placeBet(amount, betType);

            if (result.success) {
                await this.savePendingBet(userId, userSession.platform, result.issueId, betTypeStr, amount);
                if (!issueCheckers[userId]) this.startIssueChecker(userId);

                await this.bot.editMessageText(`Bet Placed Successfully!\n\nIssue: ${result.issueId}\nType: ${betTypeStr}\nAmount: ${amount.toLocaleString()} K`, {
                    chat_id: chatId,
                    message_id: loadingMsg.message_id
                });
            } else {
                await this.bot.editMessageText(`Bet Failed\n\nError: ${result.message}`, {
                    chat_id: chatId,
                    message_id: loadingMsg.message_id
                });
            }
        } catch (error) {
            await this.bot.sendMessage(chatId, `Bet Error: ${error.message}`);
        }
    }

    async placeColourBet(chatId, userId, colour) {
        const userSession = this.ensureUserSession(userId);
        if (!userSession.loggedIn) {
            await this.bot.sendMessage(chatId, "Please login to Shwe Lottery first!");
            return;
        }

        try {
            const currentIssue = await userSession.apiInstance.getCurrentIssue();
            if (!currentIssue) {
                await this.bot.sendMessage(chatId, "Cannot get current game issue. Please try again.");
                return;
            }

            if (await this.hasUserBetOnIssue(userId, userSession.platform, currentIssue)) {
                await this.bot.sendMessage(chatId, `Wait for next period\n\nYou have already placed a bet on issue ${currentIssue}.`);
                return;
            }

            let amount = await this.getCurrentBetAmount(userId);
            const betType = SIX_LOTTERY_BET_TYPES[colour];

            const balance = await userSession.apiInstance.getBalance();
            if (balance < amount) {
                await this.bot.sendMessage(chatId, `Insufficient balance!\nYou have: ${balance.toLocaleString()} K\nNeed: ${amount.toLocaleString()} K`);
                return;
            }

            const loadingMsg = await this.bot.sendMessage(chatId, `Placing ${colour} Bet on Shwe Lottery...`);
            const result = await userSession.apiInstance.placeBet(amount, betType);

            if (result.success) {
                await this.savePendingBet(userId, userSession.platform, result.issueId, colour, amount);
                if (!issueCheckers[userId]) this.startIssueChecker(userId);

                await this.bot.editMessageText(`Colour Bet Placed Successfully!\n\nIssue: ${result.issueId}\nType: ${colour}\nAmount: ${amount.toLocaleString()} K`, {
                    chat_id: chatId,
                    message_id: loadingMsg.message_id
                });
            } else {
                await this.bot.editMessageText(`Bet Failed\n\nError: ${result.message}`, {
                    chat_id: chatId,
                    message_id: loadingMsg.message_id
                });
            }
        } catch (error) {
            await this.bot.sendMessage(chatId, `Colour Bet Error: ${error.message}`);
        }
    }

    async stopBot(chatId, userId) {
        try {
            delete autoBettingTasks[userId];
            delete waitingForResults[userId];
            delete issueCheckers[userId];
            await this.saveBotSession(userId, false);

            await this.bot.sendMessage(chatId, "🛑 Bot Stopped!", {
                reply_markup: this.getMainKeyboard()
            });
        } catch (error) {
            console.error(`Error stopping bot:`, error);
        }
    }

    startIssueChecker(userId) {
        if (issueCheckers[userId]) return;
        issueCheckers[userId] = true;

        const userSession = userSessions[userId];
        if (!userSession || !userSession.apiInstance) return;

        let lastCheckedIssue = '';
        const checkLoop = async () => {
            if (!issueCheckers[userId]) return;

            try {
                const currentIssue = await userSession.apiInstance.getCurrentIssue();
                if (currentIssue && currentIssue !== lastCheckedIssue) {
                    if (lastCheckedIssue) {
                        await this.checkSingleBetResult(userId, lastCheckedIssue);
                    }
                    lastCheckedIssue = currentIssue;
                }
                setTimeout(checkLoop, 3000);
            } catch (error) {
                setTimeout(checkLoop, 10000);
            }
        };

        userSession.apiInstance.getCurrentIssue().then(issue => {
            if (issue) lastCheckedIssue = issue;
            checkLoop();
        }).catch(() => setTimeout(checkLoop, 10000));
    }

    async checkSingleBetResult(userId, issue) {
        try {
            const userSession = userSessions[userId];
            if (!userSession || !userSession.apiInstance) return;

            const platform = userSession.platform || 'SHWE';
            const pendingBet = await this.db.get(
                'SELECT platform, issue, bet_type, amount FROM pending_bets WHERE user_id = ? AND platform = ? AND issue = ?',
                [userId, platform, issue]
            );

            if (!pendingBet) return;

            const betTypeStr = pendingBet.bet_type;
            const amount = pendingBet.amount;
            const results = await userSession.apiInstance.getRecentResults(20);

            let resultFound = false;
            let betResult = "UNKNOWN";
            let profitLoss = 0;
            let resultNumber = "";
            let resultType = "";
            let resultColour = "";

            for (const result of results) {
                if (result.issueNumber === issue) {
                    resultFound = true;
                    resultNumber = result.number || 'N/A';
                    resultColour = result.colour || 'UNKNOWN';
                    resultType = ['0','1','2','3','4'].includes(resultNumber) ? "SMALL" : "BIG";

                    if (betTypeStr.includes("BIG") || betTypeStr.includes("SMALL")) {
                        if ((betTypeStr.includes("BIG") && resultType === "BIG") || 
                            (betTypeStr.includes("SMALL") && resultType === "SMALL")) {
                            betResult = "WIN";
                            profitLoss = Math.floor(amount * 1.96);
                        } else {
                            betResult = "LOSE";
                            profitLoss = -amount;
                        }
                    } else if (["RED", "GREEN", "VIOLET"].some(c => betTypeStr.includes(c))) {
                        if ((betTypeStr.includes("RED") && resultColour === "RED") ||
                            (betTypeStr.includes("GREEN") && resultColour === "GREEN") ||
                            (betTypeStr.includes("VIOLET") && resultColour === "VIOLET")) {
                            betResult = "WIN";
                            profitLoss = Math.floor(amount * 1.96);
                        } else {
                            betResult = "LOSE";
                            profitLoss = -amount;
                        }
                    }
                    break;
                }
            }

            if (!resultFound || betResult === "UNKNOWN") return;

            await this.db.run(
                'INSERT INTO bet_history (user_id, platform, issue, bet_type, amount, result, profit_loss) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [userId, platform, issue, betTypeStr, amount, betResult, profitLoss]
            );

            await this.db.run(
                'DELETE FROM pending_bets WHERE user_id = ? AND platform = ? AND issue = ?',
                [userId, platform, issue]
            );

            const actualProfit = betResult === "WIN" ? profitLoss - amount : profitLoss;
            const botSession = await this.getBotSession(userId);
            const newTotalProfit = (botSession.total_profit || 0) + actualProfit;

            await this.updateBotStats(userId, actualProfit, newTotalProfit);
            await this.updateBetSequence(userId, betResult);

            waitingForResults[userId] = false;
            await this.sendResultMessage(userId, issue, betTypeStr, amount, betResult, actualProfit, resultNumber, resultType, resultColour, newTotalProfit);
        } catch (error) {
            console.error(`Error checking result:`, error);
            waitingForResults[userId] = false;
        }
    }

    async sendResultMessage(userId, issue, betTypeStr, amount, betResult, profitLoss, resultNumber, resultType, resultColour, totalProfit = 0) {
        try {
            const chatId = userId;
            let message = betResult === "WIN" ? 
                `🚀 BET RESULT - WIN! 🎉\n\n🏆 PROFIT: +${profitLoss.toLocaleString()} K\n🏆 TOTAL PROFIT: ${totalProfit.toLocaleString()} K` :
                `🚀 BET RESULT - LOSS! 💔\n\nLOSS: -${amount.toLocaleString()} K\nTOTAL PROFIT: ${totalProfit.toLocaleString()} K`;

            await this.bot.sendMessage(chatId, message);
        } catch (error) {
            console.error(`Error sending result:`, error);
        }
    }

    async updateBetSequence(userId, result) {
        try {
            // Default ကို 'loss' (Loss Crease) ဖြင့်သာ အသုံးပြုပါသည်
            const creaseMode = await this.getUserSetting(userId, 'crease_mode', 'loss');
            const currentIndex = await this.getUserSetting(userId, 'current_bet_index', 0);
            const betSequence = await this.getUserSetting(userId, 'bet_sequence', '100,300,700,1600,3200,7600,16000,32000');
            const amounts = betSequence.split(',').map(x => parseInt(x.trim()));

            let newIndex = 0;
            if (creaseMode === 'win') {
                // Win Crease: Win ရင် တိုး၊ Lose ရင် step 1
                newIndex = result === "WIN" ? currentIndex + 1 : 0;
            } else {
                // Loss Crease (Default): Lose ရင် step တိုး၊ Win ရင် step 1 ပြန်စ
                newIndex = result === "LOSE" ? currentIndex + 1 : 0;
            }

            if (newIndex >= amounts.length) {
                newIndex = 0;
            }

            await this.saveUserSetting(userId, 'current_bet_index', newIndex);
            return newIndex;
        } catch (error) {
            return 0;
        }
    }

    async updateBotStats(userId, profit = 0, totalProfit = null) {
        try {
            const session = await this.getBotSession(userId);
            const newTotalBets = session.total_bets + 1;
            const newTotalProfit = totalProfit !== null ? totalProfit : session.total_profit + profit;
            let newSessionProfit = session.session_profit;
            let newSessionLoss = session.session_loss;

            if (profit > 0) newSessionProfit += profit;
            else newSessionLoss += Math.abs(profit);

            await this.saveBotSession(userId, true, newTotalBets, newTotalProfit, newSessionProfit, newSessionLoss);
        } catch (error) {
            console.error(`Error updating bot stats:`, error);
        }
    }

    async runBot(chatId, userId) {
        const userSession = this.ensureUserSession(userId);
        const userInfo = await userSession.apiInstance.getUserInfo();
        const gameId = String(userInfo.userId).trim();
        const isPremium = await this.isGameIdAllowed(gameId);

        if (!isPremium) {
            const trial = await this.db.get("SELECT trial_start, trial_expire FROM users WHERE user_id = ?", [userId]);
            if (!trial || trial.trial_start == 0 || Date.now() > trial.trial_expire) {
                await this.bot.sendMessage(chatId, "❌ Trial Expired or Not Found. Contact Admin.");
                return;
            }
        }

        if (autoBettingTasks[userId]) {
            await this.bot.sendMessage(chatId, "Bot is already running!");
            return;
        }

        autoBettingTasks[userId] = true;
        waitingForResults[userId] = false;

        await this.resetSessionStats(userId);
        await this.saveBotSession(userId, true);

        const creaseMode = await this.getUserSetting(userId, 'crease_mode', 'loss');
        const creaseModeText = creaseMode === 'win' ? 'Win Crease' : 'Loss Crease';

        await this.bot.sendMessage(chatId, `🚀 Shwe Lottery Auto Bot Started!\nGame Type: ${userSession.gameType}\nCrease Mode: ${creaseModeText}`);
        this.startAutoBetting(userId);
    }

    startAutoBetting(userId) {
        const userSession = userSessions[userId];
        if (!userSession || !userSession.apiInstance) return;

        let lastIssue = '';
        const bettingLoop = async () => {
            if (!autoBettingTasks[userId]) return;

            try {
                if (waitingForResults[userId]) {
                    setTimeout(bettingLoop, 3000);
                    return;
                }

                const currentIssue = await userSession.apiInstance.getCurrentIssue();
                if (currentIssue && currentIssue !== lastIssue) {
                    setTimeout(async () => {
                        if (!autoBettingTasks[userId]) return;
                        if (!(await this.hasUserBetOnIssue(userId, userSession.platform, currentIssue))) {
                            await this.placeAutoBet(userId, currentIssue);
                            lastIssue = currentIssue;
                        }
                        setTimeout(bettingLoop, 2000);
                    }, 3000);
                } else {
                    setTimeout(bettingLoop, 3000);
                }
            } catch (error) {
                setTimeout(bettingLoop, 5000);
            }
        };
        bettingLoop();
    }

    async placeAutoBet(userId, issue) {
        const userSession = userSessions[userId];
        if (!userSession || !userSession.loggedIn) return;

        waitingForResults[userId] = true;
        const followInverse = await this.getUserSetting(userId, 'follow_inverse', 0);
        const randomMode = await this.getUserSetting(userId, 'random_betting', 'bot');

        let betType, betTypeStr;

        try {
            if (followInverse) {
                const inverseResult = await this.getFollowInverseBetType(userSession.apiInstance);
                betType = inverseResult.betType;
                betTypeStr = inverseResult.betTypeStr;
            } else {
                switch(randomMode) {
                    case 'big':
                        betType = 13;
                        betTypeStr = "BIG";
                        break;
                    case 'small':
                        betType = 14;
                        betTypeStr = "SMALL";
                        break;
                    case 'bs_formula':
                        const bsResult = await this.getBsFormulaBetType(userId);
                        betType = bsResult.betType;
                        betTypeStr = bsResult.betTypeStr;
                        break;
                    case 'colour_formula':
                        const colResult = await this.getColourFormulaBetType(userId);
                        betType = colResult.betType;
                        betTypeStr = colResult.betTypeStr;
                        break;
                    default:
                        betType = Math.random() < 0.5 ? 13 : 14;
                        betTypeStr = betType === 13 ? "BIG" : "SMALL";
                }
            }

            let amount = await this.getCurrentBetAmount(userId);
            const balance = await userSession.apiInstance.getBalance();

            if (balance < amount) {
                this.bot.sendMessage(userId, `Insufficient Balance!\nNeed: ${amount} K | Available: ${balance} K`).catch(console.error);
                delete autoBettingTasks[userId];
                waitingForResults[userId] = false;
                return;
            }

            const cleanBetTypeStr = betTypeStr.replace(/\(.*?\)/g, "").trim();
            await this.bot.sendMessage(userId, `💡 ${issue}\n🧠 ${cleanBetTypeStr}\n⚡ ${amount.toLocaleString()} K`);

            const result = await userSession.apiInstance.placeBet(amount, betType);
            if (result.success) {
                await this.savePendingBet(userId, userSession.platform, result.issueId, cleanBetTypeStr, amount);
                if (!issueCheckers[userId]) this.startIssueChecker(userId);
            } else {
                waitingForResults[userId] = false;
            }
        } catch (error) {
            waitingForResults[userId] = false;
        }
    }

    async getCurrentBetAmount(userId) {
        try {
            const currentIndex = await this.getUserSetting(userId, 'current_bet_index', 0);
            const betSequence = await this.getUserSetting(userId, 'bet_sequence', '100,300,700,1600,3200,7600,16000,32000');
            const amounts = betSequence.split(',').map(x => parseInt(x.trim()));
            const actualIndex = currentIndex >= amounts.length ? 0 : currentIndex;
            return amounts[actualIndex] || 100;
        } catch (error) {
            return 100;
        }
    }

    async isGameIdAllowed(gameId) {
        try {
            const allowedIds = await this.getAllowedGameIds();
            return allowedIds.map(id => String(id).trim()).includes(String(gameId).trim());
        } catch (error) {
            return false;
        }
    }

    async getAllowedGameIds() {
        try {
            const results = await this.db.all('SELECT game_id FROM allowed_game_ids ORDER BY added_at DESC');
            return results.map(row => row.game_id);
        } catch (error) {
            return [];
        }
    }

    async hasUserBetOnIssue(userId, platform, issue) {
        try {
            const result = await this.db.get('SELECT issue FROM pending_bets WHERE user_id = ? AND platform = ? AND issue = ?', [userId, platform, issue]);
            return result !== undefined;
        } catch (error) {
            return false;
        }
    }

    async savePendingBet(userId, platform, issue, betType, amount) {
        try {
            await this.db.run('INSERT INTO pending_bets (user_id, platform, issue, bet_type, amount) VALUES (?, ?, ?, ?, ?)', [userId, platform, issue, betType, amount]);
            return true;
        } catch (error) {
            return false;
        }
    }

    async saveUserSetting(userId, key, value) {
        try {
            const existing = await this.db.get('SELECT user_id FROM user_settings WHERE user_id = ?', [userId]);
            if (!existing) {
                await this.db.run('INSERT INTO user_settings (user_id) VALUES (?)', [userId]);
            }
            await this.db.run(`UPDATE user_settings SET ${key} = ? WHERE user_id = ?`, [value, userId]);
            return true;
        } catch (error) {
            return false;
        }
    }

    async getUserSetting(userId, key, defaultValue = null) {
        try {
            const result = await this.db.get(`SELECT ${key} FROM user_settings WHERE user_id = ?`, [userId]);
            // crease_mode အတွက် 'none' ဖြစ်နေပါကလည်း 'loss' သို့ ပြောင်းပေးပါသည်
            if (key === 'crease_mode' && (!result || !result[key] || result[key] === 'none')) {
                return 'loss';
            }
            return result ? result[key] : defaultValue;
        } catch (error) {
            return defaultValue;
        }
    }

    async saveBotSession(userId, isRunning = false, totalBets = 0, totalProfit = 0, sessionProfit = 0, sessionLoss = 0) {
        try {
            await this.db.run(
                'INSERT OR REPLACE INTO bot_sessions (user_id, is_running, total_bets, total_profit, session_profit, session_loss, last_activity) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)',
                [userId, isRunning ? 1 : 0, totalBets, totalProfit, sessionProfit, sessionLoss]
            );
            return true;
        } catch (error) {
            return false;
        }
    }

    async getBotSession(userId) {
        try {
            const result = await this.db.get('SELECT is_running, total_bets, total_profit, session_profit, session_loss FROM bot_sessions WHERE user_id = ?', [userId]);
            if (result) {
                return {
                    is_running: Boolean(result.is_running),
                    total_bets: result.total_bets || 0,
                    total_profit: result.total_profit || 0,
                    session_profit: result.session_profit || 0,
                    session_loss: result.session_loss || 0
                };
            }
            return { is_running: false, total_bets: 0, total_profit: 0, session_profit: 0, session_loss: 0 };
        } catch (error) {
            return { is_running: false, total_bets: 0, total_profit: 0, session_profit: 0, session_loss: 0 };
        }
    }

    async resetSessionStats(userId) {
        try {
            await this.saveBotSession(userId, false, 0, 0, 0, 0);
            return true;
        } catch (error) {
            return false;
        }
    }

    async setRandomBig(chatId, userId) {
        await this.saveUserSetting(userId, 'random_betting', 'big');
        await this.clearFormulaPatterns(userId);
        await this.saveUserSetting(userId, 'follow_inverse', 0);
        await this.bot.sendMessage(chatId, "Random Mode: BIG Only");
    }

    async setRandomSmall(chatId, userId) {
        await this.saveUserSetting(userId, 'random_betting', 'small');
        await this.clearFormulaPatterns(userId);
        await this.saveUserSetting(userId, 'follow_inverse', 0);
        await this.bot.sendMessage(chatId, "Random Mode: SMALL Only");
    }

    async setRandomBot(chatId, userId) {
        await this.saveUserSetting(userId, 'random_betting', 'bot');
        await this.clearFormulaPatterns(userId);
        await this.saveUserSetting(userId, 'follow_inverse', 0);
        await this.bot.sendMessage(chatId, "Random Mode: Random Bot");
    }

    async setFollowBot(chatId, userId) {
        await this.saveUserSetting(userId, 'random_betting', 'follow');
        await this.clearFormulaPatterns(userId);
        await this.saveUserSetting(userId, 'follow_inverse', 0);
        await this.bot.sendMessage(chatId, "Random Mode: Follow Bot");
    }

    async getFormulaPatterns(userId) {
        try {
            const result = await this.db.get('SELECT bs_pattern, colour_pattern, bs_current_index, colour_current_index FROM formula_patterns WHERE user_id = ?', [userId]);
            return result || { bs_pattern: "", colour_pattern: "", bs_current_index: 0, colour_current_index: 0 };
        } catch (error) {
            return { bs_pattern: "", colour_pattern: "", bs_current_index: 0, colour_current_index: 0 };
        }
    }

    async clearFormulaPatterns(userId) {
        try {
            await this.db.run('UPDATE formula_patterns SET bs_pattern = "", colour_pattern = "", bs_current_index = 0, colour_current_index = 0 WHERE user_id = ?', [userId]);
            return true;
        } catch (error) {
            return false;
        }
    }

    async getBetHistory(userId, platform = null, limit = 10) {
        try {
            return await this.db.all('SELECT platform, issue, bet_type, amount, result, profit_loss, created_at FROM bet_history WHERE user_id = ? ORDER BY created_at DESC LIMIT ?', [userId, limit]);
        } catch (error) {
            return [];
        }
    }

    async showBotSettings(chatId, userId) {
        try {
            const userSession = this.ensureUserSession(userId);
            const betSequence = await this.getUserSetting(userId, 'bet_sequence', '100,300,700,1600,3200,7600,16000,32000');
            const currentIndex = await this.getUserSetting(userId, 'current_bet_index', 0);
            const creaseMode = await this.getUserSetting(userId, 'crease_mode', 'loss');
            const currentAmount = await this.getCurrentBetAmount(userId);

            const creaseModeText = creaseMode === 'win' ? "Win Crease" : "Loss Crease";
            const settingsText = `Current Settings:
Platform: Shwe Lottery
Crease Mode: ${creaseModeText}
Bet Sequence: ${betSequence}
Current Step: ${currentIndex + 1}
Current Bet: ${currentAmount.toLocaleString()} K`;

            await this.bot.sendMessage(chatId, settingsText, {
                reply_markup: this.getBotSettingsKeyboard()
            });
        } catch (error) {
            await this.bot.sendMessage(chatId, "Error loading bot settings.");
        }
    }

    async showMyBets(chatId, userId) {
        try {
            const myBets = await this.getBetHistory(userId, null, 10);
            if (!myBets || myBets.length === 0) {
                await this.bot.sendMessage(chatId, "No bet history found for Shwe Lottery.");
                return;
            }

            let betsText = `Your Recent Bets (Shwe Lottery)\n\n`;
            myBets.forEach((bet, i) => {
                const res = bet.result === "WIN" ? `WIN (+${bet.profit_loss})` : `LOSE (${bet.profit_loss})`;
                betsText += `${i+1}. ${bet.issue} - ${bet.bet_type} - ${bet.amount.toLocaleString()}K - ${res}\n`;
            });

            await this.bot.sendMessage(chatId, betsText);
        } catch (error) {
            await this.bot.sendMessage(chatId, "Error getting bet history.");
        }
    }

    // ✅ Bot Info တွင် Shwe Lottery နှင့် Default Loss Crease ကို သေချာဖော်ပြထားပါသည်
    async showBotInfo(chatId, userId) {
        const userSession = this.ensureUserSession(userId);

        try {
            let userInfo = {};
            let balance = 0;
            if (userSession.loggedIn && userSession.apiInstance) {
                balance = await userSession.apiInstance.getBalance();
                userInfo = await userSession.apiInstance.getUserInfo();
            }

            const phone = userSession.phone ? this.maskPhoneNumber(userSession.phone) : 'Not logged in';
            const botSession = await this.getBotSession(userId);
            const betSequence = await this.getUserSetting(userId, 'bet_sequence', '100,300,700,1600,3200,7600,16000,32000');
            const currentIndex = await this.getUserSetting(userId, 'current_bet_index', 0);
            const currentAmount = await this.getCurrentBetAmount(userId);
            const profitTarget = await this.getUserSetting(userId, 'profit_target', 0);
            const lossTarget = await this.getUserSetting(userId, 'loss_target', 0);

            // Crease Mode ဖော်ပြမှု (Default အားဖြင့် Loss Crease ဖြစ်စေသည်)
            const creaseMode = await this.getUserSetting(userId, 'crease_mode', 'loss');
            const creaseModeText = creaseMode === 'win' ? 'Win Crease' : 'Loss Crease';

            const botInfoText = `🤖 **SHWE LOTTERY BOT INFORMATION**

• **User Information:**
Platform: Shwe Lottery
User ID: ${userInfo.userId || 'N/A'}
Phone: ${phone}
Balance: ${balance.toLocaleString()} K
Game Type: ${userSession.gameType || 'WINGO_30S'}

• **Bot Settings:**
Crease Mode: ${creaseModeText}
Bet Sequence: ${betSequence}
Current Bet: ${currentAmount.toLocaleString()} K (Step ${currentIndex + 1})
Bot Status: ${botSession.is_running ? 'RUNNING 🟢' : 'STOPPED 🔴'}

• **Targets:**
Profit Target: ${profitTarget > 0 ? profitTarget.toLocaleString() + ' K' : 'Disabled'}
Loss Target: ${lossTarget > 0 ? lossTarget.toLocaleString() + ' K' : 'Disabled'}`;

            await this.bot.sendMessage(chatId, botInfoText, { parse_mode: 'Markdown' });
        } catch (error) {
            console.error("Error in showBotInfo:", error);
            await this.bot.sendMessage(chatId, "Error loading bot information.");
        }
    }

    async showBsFormula(chatId, userId) {
        const patternsData = await this.getFormulaPatterns(userId);
        await this.bot.sendMessage(chatId, `BS Formula Pattern: ${patternsData.bs_pattern || "Not set"}`, {
            reply_markup: this.getBsPatternKeyboard()
        });
    }

    async showColourFormula(chatId, userId) {
        const patternsData = await this.getFormulaPatterns(userId);
        await this.bot.sendMessage(chatId, `Colour Formula Pattern: ${patternsData.colour_pattern || "Not set"}`, {
            reply_markup: this.getColourPatternKeyboard()
        });
    }

    async viewBsPattern(chatId, userId) {
        const patternsData = await this.getFormulaPatterns(userId);
        await this.bot.sendMessage(chatId, `Current BS Pattern: ${patternsData.bs_pattern || "None"}`);
    }

    async viewColourPattern(chatId, userId) {
        const patternsData = await this.getFormulaPatterns(userId);
        await this.bot.sendMessage(chatId, `Current Colour Pattern: ${patternsData.colour_pattern || "None"}`);
    }

    async clearBsPattern(chatId, userId) {
        await this.clearFormulaPatterns(userId);
        await this.bot.sendMessage(chatId, "BS Pattern Cleared!", { reply_markup: this.getBsPatternKeyboard() });
    }

    async clearColourPattern(chatId, userId) {
        await this.clearFormulaPatterns(userId);
        await this.bot.sendMessage(chatId, "Colour Pattern Cleared!", { reply_markup: this.getColourPatternKeyboard() });
    }

    async handleSetBetSequence(chatId, userId, text) {
        const amounts = text.trim().split(',').map(x => parseInt(x.trim())).filter(x => !isNaN(x) && x >= 100);
        if (amounts.length === 0) {
            await this.bot.sendMessage(chatId, "Invalid sequence! Enter numbers >= 100 separated by comma.");
            return;
        }

        const newSeq = amounts.join(',');
        await this.saveUserSetting(userId, 'bet_sequence', newSeq);
        await this.saveUserSetting(userId, 'current_bet_index', 0);
        await this.bot.sendMessage(chatId, `✅ Bet Sequence Updated: ${newSeq}`);
        this.ensureUserSession(userId).step = 'main';
    }

    async handleSetProfitTarget(chatId, userId, text) {
        const target = parseInt(text.trim()) || 0;
        await this.saveUserSetting(userId, 'profit_target', target);
        await this.bot.sendMessage(chatId, `Profit Target set to: ${target.toLocaleString()} K`);
        this.ensureUserSession(userId).step = 'main';
    }

    async handleSetLossTarget(chatId, userId, text) {
        const target = parseInt(text.trim()) || 0;
        await this.saveUserSetting(userId, 'loss_target', target);
        await this.bot.sendMessage(chatId, `Loss Target set to: ${target.toLocaleString()} K`);
        this.ensureUserSession(userId).step = 'main';
    }

    async handleSetBsPattern(chatId, userId, text) {
        const pattern = text.trim().toUpperCase().replace(/[^BS,]/g, '');
        await this.db.run('INSERT OR REPLACE INTO formula_patterns (user_id, bs_pattern, bs_current_index) VALUES (?, ?, 0)', [userId, pattern]);
        await this.saveUserSetting(userId, 'random_betting', 'bs_formula');
        await this.bot.sendMessage(chatId, `BS Pattern saved: ${pattern}`);
        this.ensureUserSession(userId).step = 'main';
    }

    async handleSetColourPattern(chatId, userId, text) {
        const pattern = text.trim().toUpperCase().replace(/[^GRV,]/g, '');
        await this.db.run('INSERT OR REPLACE INTO formula_patterns (user_id, colour_pattern, colour_current_index) VALUES (?, ?, 0)', [userId, pattern]);
        await this.saveUserSetting(userId, 'random_betting', 'colour_formula');
        await this.bot.sendMessage(chatId, `Colour Pattern saved: ${pattern}`);
        this.ensureUserSession(userId).step = 'main';
    }

    async handleAddGameId(msg, match) {
        const chatId = msg.chat.id;
        if (String(chatId) !== ADMIN_USER_ID) return;
        const gameIds = match[1].split(',').map(id => id.trim()).filter(id => /^\d+$/.test(id));

        for (const gameId of gameIds) {
            await this.db.run('INSERT OR REPLACE INTO allowed_game_ids (game_id) VALUES (?)', [gameId]);
            await this.db.run('UPDATE users SET trial_start = 0, trial_expire = 0 WHERE game_id = ?', [gameId]);
        }
        await this.bot.sendMessage(chatId, `Added Game IDs: ${gameIds.join(', ')}`);
    }

    async handleRemoveGameId(msg, match) {
        const chatId = msg.chat.id;
        if (String(chatId) !== ADMIN_USER_ID) return;
        const gameId = match[1].trim();

        await this.db.run('DELETE FROM allowed_game_ids WHERE game_id = ?', [gameId]);
        await this.db.run('UPDATE users SET trial_expire = 0 WHERE game_id = ?', [gameId]);
        await this.bot.sendMessage(chatId, `Removed Game ID: ${gameId}`);
    }

    async handleListGameIds(msg) {
        const chatId = msg.chat.id;
        if (String(chatId) !== ADMIN_USER_ID) return;

        const users = await this.db.all('SELECT game_id FROM allowed_game_ids');
        const list = users.map((u, i) => `${i+1}. ${u.game_id}`).join('\n');
        await this.bot.sendMessage(chatId, `Allowed Game IDs:\n\n${list || 'None'}`);
    }

    async handleGameIdStats(msg) {
        const chatId = msg.chat.id;
        if (String(chatId) !== ADMIN_USER_ID) return;
        const total = await this.db.get('SELECT COUNT(*) as count FROM allowed_game_ids');
        await this.bot.sendMessage(chatId, `Total Premium IDs: ${total.count || 0}`);
    }

    async handleBroadcastMessage(msg, match) {
        const chatId = msg.chat.id;
        if (String(chatId) !== ADMIN_USER_ID) return;
        const users = await this.db.all('SELECT user_id FROM users');
        for (const user of users) {
            try {
                await this.bot.sendMessage(user.user_id, `📢 Broadcast:\n\n${match[1]}`);
            } catch (e) {}
        }
        await this.bot.sendMessage(chatId, "Broadcast completed.");
    }

    async handleBroadcastActive(msg, match) {
        const chatId = msg.chat.id;
        if (String(chatId) !== ADMIN_USER_ID) return;
        const users = await this.db.all('SELECT user_id FROM bot_sessions WHERE is_running = 1');
        for (const user of users) {
            try {
                await this.bot.sendMessage(user.user_id, `📢 ${match[1]}`);
            } catch (e) {}
        }
        await this.bot.sendMessage(chatId, "Active broadcast completed.");
    }
}

console.log("Shwe Lottery Auto Bot starting...");
console.log("Platform: Shwe Lottery ONLY");
console.log("Default Crease Mode: Loss Crease");
console.log("Admin User ID: " + ADMIN_USER_ID);

const bot = new AutoLotteryBot();

process.on('SIGINT', () => {
    console.log('Bot shutting down...');
    process.exit();
});
