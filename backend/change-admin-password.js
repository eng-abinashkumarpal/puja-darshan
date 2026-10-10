const fs = require('fs');
const path = require('path');
const readline = require('readline');
const bcrypt = require('bcryptjs');

const envPath = path.join(__dirname, '.env');

function hiddenInput(prompt) {
    return new Promise((resolve, reject) => {
        const input = process.stdin;

        if (!input.isTTY || !input.setRawMode) {
            reject(new Error('Run this in an interactive Git Bash terminal.'));
            return;
        }

        process.stdout.write(prompt);
        let value = '';

        const cleanup = () => {
            input.removeListener('data', onData);
            input.setRawMode(false);
            input.pause();
            process.stdout.write('\n');
        };

        function onData(char) {
            if (char === '\u0003') {
                cleanup();
                reject(new Error('Cancelled.'));
            } else if (char === '\r' || char === '\n') {
                cleanup();
                resolve(value);
            } else if (char === '\u007f' || char === '\b') {
                value = value.slice(0, -1);
            } else if (char >= ' ') {
                value += char;
            }
        }

        input.setRawMode(true);
        input.setEncoding('utf8');
        input.resume();
        input.on('data', onData);
    });
}

async function main() {
    if (!fs.existsSync(envPath)) {
        throw new Error('backend/.env not found.');
    }

    const first = await hiddenInput('Enter NEW password (12+ characters): ');
    if (first.length < 12) {
        throw new Error('Password must be at least 12 characters.');
    }

    const second = await hiddenInput('Confirm NEW password: ');
    if (first !== second) {
        throw new Error('Passwords do not match.');
    }

    const hash = await bcrypt.hash(first, 12);
    const lines = fs.readFileSync(envPath, 'utf8')
        .split(/\r?\n/)
        .filter(line => !line.startsWith('ADMIN_PASSWORD_HASH='));

    lines.push(`ADMIN_PASSWORD_HASH=${hash}`);
    fs.writeFileSync(envPath, lines.join('\n').replace(/\n*$/, '\n'), {
        mode: 0o600
    });

    console.log('Admin password hash updated successfully.');
    console.log('Other environment settings were preserved.');
}

main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
});
