const fs = require('fs');
const path = require('path');
const {DATABASE_FILE} = require('./config');

class PidorDatabase {
    constructor() {
        this.dbPath = path.resolve(DATABASE_FILE);
        this.ensureDatabase();
    }
    
    ensureDatabase() {
        if (!fs.existsSync(this.dbPath)) {
            fs.writeFileSync(this.dbPath, JSON.stringify({
                users: {},
                dailyPidors: [],
                monthlyPidors: [],
                yearlyPidors: [],
                stats: {
                    totalPidorCount: {},
                },
            }, null, 2));
        }
    }
    
    readDatabase() {
        return JSON.parse(fs.readFileSync(this.dbPath, 'utf8'));
    }
    
    writeDatabase(data) {
        fs.writeFileSync(this.dbPath, JSON.stringify(data, null, 2));
    }
    
    registerUser(userId, username) {
        const db = this.readDatabase();
        if (!db.users[userId]) {
            db.users[userId] = {
                username,
                pidorCount: 0,
                lastPidorDate: null,
            };
            this.writeDatabase(db);
        }
        return db.users[userId];
    }
    
    recordDailyPidor(userId) {
        const db = this.readDatabase();
        const today = new Date().toISOString().split('T')[0];
        
        db.dailyPidors.push({
            userId,
            date: today,
        });
        
        // Увеличиваем статистику пидоров для пользователя
        if (!db.stats.totalPidorCount[userId]) {
            db.stats.totalPidorCount[userId] = 0;
        }
        db.stats.totalPidorCount[userId]++;
        
        // Обновляем информацию о пользователе
        if (db.users[userId]) {
            db.users[userId].pidorCount++;
            db.users[userId].lastPidorDate = today;
        }
        
        this.writeDatabase(db);
    }
    
    getMonthlyPidor() {
        const db = this.readDatabase();
        const currentMonth = new Date().getMonth();
        const monthlyPidors = db.dailyPidors.filter(pidor =>
            new Date(pidor.date).getMonth() === currentMonth,
        );
        
        // Находим пользователя с максимальным количеством попаданий
        const pidorCounts = monthlyPidors.reduce((acc, pidor) => {
            acc[pidor.userId] = (acc[pidor.userId] || 0) + 1;
            return acc;
        }, {});
        
        const monthlyPidorId = Object.keys(pidorCounts).reduce((a, b) =>
            pidorCounts[a] > pidorCounts[b] ? a : b,
        );
        
        return {
            userId: monthlyPidorId,
            count: pidorCounts[monthlyPidorId],
        };
    }
    
    getYearlyPidor() {
        const db = this.readDatabase();
        const currentYear = new Date().getFullYear();
        const yearlyPidors = db.dailyPidors.filter(pidor =>
            new Date(pidor.date).getFullYear() === currentYear,
        );
        
        const pidorCounts = yearlyPidors.reduce((acc, pidor) => {
            acc[pidor.userId] = (acc[pidor.userId] || 0) + 1;
            return acc;
        }, {});
        
        const yearlyPidorId = Object.keys(pidorCounts).reduce((a, b) =>
            pidorCounts[a] > pidorCounts[b] ? a : b,
        );
        
        return {
            userId: yearlyPidorId,
            count: pidorCounts[yearlyPidorId],
        };
    }
}

module.exports = new PidorDatabase();
