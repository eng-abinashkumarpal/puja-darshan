const fs = require('fs');
const path = require('path');
const readline = require('readline');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const envPath = path.join(__dirname, '.env');

if (fs.existsSync(envPath)) {
    console.error('backend/.env already exists. Keeping it unchanged.');
    process.exit(1);
}

function ask(question) {
    return new Promise(resolve => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        rl.question(question, answer => {
            rl.close();
            resolve(answer.trim());
        });
    });
}

function askHidden(question) {
    return new Promise((resolve, reject) => {
        const input = process.stdin;
        if (!input.isTTY || !input.setRawMode) {
            reject(new Error('Run this script in an interactive Git Bash terminal.'));
            return;
        }

        process.stdout.write(question);
        let value = '';

        const cleanup = () => {
            input.removeListener('data', onData);
            input.setRawMode(false);
            input.pause();
            process.stdout.write('\n');
        };

        const onData = char => {
            if (char === '\u0003') {
                cleanup();
                reject(new Error('Cancelled.'));
                return;
            }

            if (char === '\r' || char === '\n') {
                cleanup();
                resolve(value);
            } else if (char === '\u007f' || char === '\b') {
                value = value.slice(0, -1);
            } else if (char >= ' ') {
                value += char;
            }
        };

        input.setRawMode(true);
        input.resume();
        input.setEncoding('utf8');
        input.on('data', onData);
    });
}

async function main() {
    const username = await ask('Choose admin username: ');

    if (!/^[a-zA-Z0-9._-]{3,40}$/.test(username)) {
        throw new Error('Username must be 3-40 characters: letters, numbers, dot, underscore or hyphen.');
    }

    const password = await askHidden('Choose a strong password (input hidden): ');

    if (password.length < 12) {
        throw new Error('Use a password with at least 12 characters. Run the script again.');
    }

    const confirm = await askHidden('Enter the password again (input hidden): ');

    if (password !== confirm) {
        throw new Error('Passwords do not match. Run the script again.');
    }

    const hash = await bcrypt.hash(password, 12);
    const sessionSecret = crypto.randomBytes(48).toString('hex');

    const envContent = [
        'PORT=3000',
        'NODE_ENV=development',
        `ADMIN_USERNAME=${username}`,
        `ADMIN_PASSWORD_HASH=${hash}`,
        `SESSION_SECRET=${sessionSecret}`,
        ''
    ].join('\n');

    fs.writeFileSync(envPath, envContent, { mode: 0o600, flag: 'wx' });

    console.log('Admin configuration created successfully in backend/.env');
    console.log('Password is stored as a bcrypt hash. Keep this file private.');
}

main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
});
