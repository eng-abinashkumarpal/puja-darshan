require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const session = require('express-session');
const { RedisStore } = require('connect-redis');
const { createClient } = require('redis');
const bcrypt = require('bcryptjs');
const path = require('path');
const cloudinary = require('cloudinary').v2;
const { google } = require('googleapis');
const multer = require('multer');

const fs = require('fs');

// Mandir data storage
const MANDIR_REDIS_KEY = 'puja-darshan:mandirs';
const MANDIR_DATA_DIR = path.join(__dirname, 'data');
const MANDIR_DATA_FILE = path.join(MANDIR_DATA_DIR, 'mandirs.json');

async function readMandirs() {
    if (redisClient) {
        const saved = await redisClient.get(MANDIR_REDIS_KEY);
        if (!saved) return [];
        const data = JSON.parse(saved);
        return Array.isArray(data) ? data : [];
    }

    try {
        const data = JSON.parse(
            fs.readFileSync(MANDIR_DATA_FILE, 'utf8')
        );
        return Array.isArray(data) ? data : [];
    } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
    }
}

async function writeMandirs(mandirs) {
    const saved = JSON.stringify(mandirs, null, 2);

    if (redisClient) {
        await redisClient.set(MANDIR_REDIS_KEY, saved);
        return;
    }

    fs.mkdirSync(MANDIR_DATA_DIR, { recursive: true });
    fs.writeFileSync(MANDIR_DATA_FILE, saved, 'utf8');
}




const MANDIR_SUBMISSIONS_REDIS_KEY = 'puja-darshan:mandir-submissions';
const MANDIR_SUBMISSIONS_FILE = path.join(MANDIR_DATA_DIR, 'mandir-submissions.json');

async function readMandirSubmissions() {
    if (redisClient) {
        const saved = await redisClient.get(MANDIR_SUBMISSIONS_REDIS_KEY);
        if (!saved) return [];
        const data = JSON.parse(saved);
        return Array.isArray(data) ? data : [];
    }

    try {
        const data = JSON.parse(fs.readFileSync(MANDIR_SUBMISSIONS_FILE, 'utf8'));
        return Array.isArray(data) ? data : [];
    } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
    }
}

async function writeMandirSubmissions(submissions) {
    const saved = JSON.stringify(submissions, null, 2);

    if (redisClient) {
        await redisClient.set(MANDIR_SUBMISSIONS_REDIS_KEY, saved);
        return;
    }

    fs.mkdirSync(MANDIR_DATA_DIR, { recursive: true });
    const tempFile = MANDIR_SUBMISSIONS_FILE + '.tmp';
    fs.writeFileSync(tempFile, saved, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tempFile, MANDIR_SUBMISSIONS_FILE);
}


const VIDEO_SUBMISSIONS_REDIS_KEY = 'puja-darshan:video-submissions';
const VIDEO_SUBMISSIONS_FILE = path.join(MANDIR_DATA_DIR, 'video-submissions.json');
const VIDEO_UPLOAD_TICKET_PREFIX = 'puja-darshan:video-upload-ticket:';
const MAX_VIDEO_SUBMISSION_BYTES = 1024 * 1024 * 1024;
const VIDEO_SUBMISSION_FOLDER = 'puja-darshan/video-submissions';
const VIDEO_SUBMISSION_TAG = 'puja-darshan-pending-video-submission';
const VIDEO_SUBMISSION_TYPE = 'authenticated';
const localVideoUploadTickets = new Map();

async function readVideoSubmissions() {
    if (redisClient) {
        const saved = await redisClient.get(VIDEO_SUBMISSIONS_REDIS_KEY);
        if (!saved) return [];
        const data = JSON.parse(saved);
        return Array.isArray(data) ? data : [];
    }

    try {
        const data = JSON.parse(fs.readFileSync(VIDEO_SUBMISSIONS_FILE, 'utf8'));
        return Array.isArray(data) ? data : [];
    } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
    }
}

async function writeVideoSubmissions(submissions) {
    const saved = JSON.stringify(submissions, null, 2);

    if (redisClient) {
        await redisClient.set(VIDEO_SUBMISSIONS_REDIS_KEY, saved);
        return;
    }

    fs.mkdirSync(MANDIR_DATA_DIR, { recursive: true });
    const tempFile = VIDEO_SUBMISSIONS_FILE + '.tmp';
    fs.writeFileSync(tempFile, saved, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tempFile, VIDEO_SUBMISSIONS_FILE);
}

async function saveVideoUploadTicket(ticket) {
    if (redisClient) {
        await redisClient.set(
            VIDEO_UPLOAD_TICKET_PREFIX + ticket.id,
            JSON.stringify(ticket),
            { EX: 6 * 60 * 60, NX: true }
        );
        return;
    }
    localVideoUploadTickets.set(ticket.id, ticket);
}

async function getVideoUploadTicket(id) {
    if (redisClient) {
        const raw = await redisClient.get(VIDEO_UPLOAD_TICKET_PREFIX + id);
        if (!raw) return null;
        try {
            return JSON.parse(raw);
        } catch {
            return null;
        }
    }

    const ticket = localVideoUploadTickets.get(id);
    if (!ticket) return null;

    if (Date.now() - ticket.createdAt > 6 * 60 * 60 * 1000) {
        localVideoUploadTickets.delete(id);
        return null;
    }
    return ticket;
}

async function deleteVideoUploadTicket(id) {
    if (redisClient) {
        await redisClient.del(VIDEO_UPLOAD_TICKET_PREFIX + id);
        return;
    }
    localVideoUploadTickets.delete(id);
}

function createVideoUploadSignature(ticket) {
    const config = cloudinary.config();
    const apiSecret = process.env.CLOUDINARY_API_SECRET || config.api_secret;

    if (!config.cloud_name || !config.api_key || !apiSecret) {
        throw new Error('Cloudinary upload signing is not configured.');
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const params = {
        folder: ticket.folder,
        public_id: ticket.publicId,
        tags: ticket.tags,
        type: ticket.deliveryType,
        timestamp
    };

    return {
        cloud_name: config.cloud_name,
        api_key: config.api_key,
        signature: cloudinary.utils.api_sign_request(params, apiSecret),
        timestamp,
        folder: ticket.folder,
        public_id: ticket.publicId,
        tags: ticket.tags,
        type: ticket.deliveryType
    };
}

const ADMIN_PASSWORD_REDIS_KEY = 'puja-darshan:admin-password-hash-b64';
const ADMIN_PASSWORD_FILE = path.join(MANDIR_DATA_DIR, 'admin-password.json');

async function readAdminPasswordHashB64() {
    if (redisClient) {
        const saved = await redisClient.get(ADMIN_PASSWORD_REDIS_KEY);
        return saved || process.env.ADMIN_PASSWORD_HASH_B64 || '';
    }

    try {
        const stored = JSON.parse(fs.readFileSync(ADMIN_PASSWORD_FILE, 'utf8'));
        if (typeof stored.hashB64 === 'string' && stored.hashB64) {
            return stored.hashB64;
        }
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }

    return process.env.ADMIN_PASSWORD_HASH_B64 || '';
}

async function writeAdminPasswordHashB64(hashB64) {
    if (redisClient) {
        await redisClient.set(ADMIN_PASSWORD_REDIS_KEY, hashB64);
        return;
    }

    fs.mkdirSync(MANDIR_DATA_DIR, { recursive: true });
    const tempFile = ADMIN_PASSWORD_FILE + '.tmp';
    fs.writeFileSync(
        tempFile,
        JSON.stringify({ hashB64, updatedAt: new Date().toISOString() }, null, 2) + '\n',
        { encoding: 'utf8', mode: 0o600 }
    );
    fs.renameSync(tempFile, ADMIN_PASSWORD_FILE);
}

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const isProduction = process.env.NODE_ENV === 'production';

    if (isProduction && !process.env.REDIS_URL) {
    throw new Error('Missing required configuration: REDIS_URL');
}

const redisClient = isProduction
    ? createClient({ url: process.env.REDIS_URL })
    : null;

if (redisClient) {
    redisClient.on('error', (err) => console.error('Redis Client Error:', err));
}
const requiredEnv = [
    'ADMIN_USERNAME',
    'ADMIN_PASSWORD_HASH_B64',
    'SESSION_SECRET',
    'CLOUDINARY_CLOUD_NAME',
    'CLOUDINARY_API_KEY',
    'CLOUDINARY_API_SECRET'
];

for (const key of requiredEnv) {
    if (!process.env[key]) {
        throw new Error(`Missing required configuration: ${key}`);
    }
}

if (isProduction) {
    app.set('trust proxy', 1);
}

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

app.disable('x-powered-by');
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            ...helmet.contentSecurityPolicy.getDefaultDirectives(),
            "img-src": ["'self'", "data:", "blob:", "https://res.cloudinary.com"],
            "media-src": ["'self'", "blob:", "https://res.cloudinary.com"],
            "connect-src": ["'self'", "https://api.cloudinary.com", "https://puja-darshan-api.onrender.com"],
        }
    }
}));

// Allow the public GitHub Pages frontend to read the public Mandir API.
const allowedOrigins = new Set([
    'https://eng-abinashkumarpal.github.io',
    'http://127.0.0.1:5500',
    'http://localhost:5500'
]);
app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && allowedOrigins.has(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});

app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.use('/api', rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 100,
    standardHeaders: 'draft-8',
    legacyHeaders: false
}));

app.use(session({
    store: isProduction
        ? new RedisStore({
            client: redisClient,
            prefix: 'puja-darshan:sess:'
        })
        : undefined,
    name: 'pd.sid',
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'strict',
        maxAge: 2 * 60 * 60 * 1000
    }
}));

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many login attempts. Try again later.' }
});

const passwordChangeLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many password-change attempts. Try again later.' }
});

async function isCurrentAdminSession(req) {
    if (!req.session || req.session.isAdmin !== true) return false;
    const currentHashB64 = await readAdminPasswordHashB64();
    return Boolean(
        currentHashB64 &&
        req.session.adminPasswordHashB64 === currentHashB64
    );
}

async function requireAdmin(req, res, next) {
    try {
        if (await isCurrentAdminSession(req)) return next();
        return res.status(401).json({ error: 'Authentication required.' });
    } catch (error) {
        return next(error);
    }
}



// YouTube OAuth credentials and temporary state are stored server-side.
const YOUTUBE_CREDENTIALS_REDIS_KEY =
    'puja-darshan:youtube:credentials';

const YOUTUBE_OAUTH_STATE_PREFIX =
    'puja-darshan:youtube:oauth-state:';

function createYouTubeOAuthClient() {
    const { YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REDIRECT_URI } =
        process.env;

    if (!YOUTUBE_CLIENT_ID ||
        !YOUTUBE_CLIENT_SECRET ||
        !YOUTUBE_REDIRECT_URI) {
        return null;
    }

    return new google.auth.OAuth2(
        YOUTUBE_CLIENT_ID,
        YOUTUBE_CLIENT_SECRET,
        YOUTUBE_REDIRECT_URI
    );
}

app.get('/api/admin/youtube/status', requireAdmin, async (req, res, next) => {
    try {
        let connected = false;

        if (redisClient) {
            const raw = await redisClient.get(
                YOUTUBE_CREDENTIALS_REDIS_KEY
            );

            if (raw) {
                try {
                    const saved = JSON.parse(raw);
                    connected = typeof saved.refreshToken === 'string' &&
                        saved.refreshToken.length > 0;
                } catch {
                    connected = false;
                }
            }
        }

        res.set('Cache-Control', 'no-store');
        return res.json({
            success: true,
            configured: Boolean(createYouTubeOAuthClient()),
            connected
        });
    } catch (error) {
        next(error);
    }
});

app.get('/api/admin/youtube/connect', requireAdmin, async (req, res, next) => {
    try {
        // OAuth is enabled only where persistent Redis storage is available.
        if (!redisClient) {
            return res.status(503).json({
                error: 'YouTube connection must be initiated on the deployed backend.'
            });
        }

        const oauth = createYouTubeOAuthClient();

        if (!oauth) {
            return res.status(503).json({
                error: 'YouTube OAuth environment variables are not configured.'
            });
        }

        const state = require('crypto').randomBytes(32).toString('hex');
        const stateKey = YOUTUBE_OAUTH_STATE_PREFIX + state;

        const stored = await redisClient.set(
            stateKey,
            JSON.stringify({
                adminUsername: req.session.adminUsername || '',
                createdAt: Date.now()
            }),
            { EX: 600, NX: true }
        );

        if (stored !== 'OK') {
            return res.status(503).json({
                error: 'Could not start YouTube authorization. Please retry.'
            });
        }

        const url = oauth.generateAuthUrl({
            access_type: 'offline',
            prompt: 'consent',
            include_granted_scopes: true,
            scope: ['https://www.googleapis.com/auth/youtube.upload'],
            state
        });

        return res.redirect(302, url);
    } catch (error) {
        next(error);
    }
});

// Google redirects here after the user grants or denies permission.
// The one-time Redis state is checked because cross-site callbacks cannot
// depend on the Admin session cookie.
app.get('/api/youtube/oauth2callback', async (req, res, next) => {
    try {
        if (!redisClient) {
            return res.status(503).send(
                'YouTube authorization requires persistent backend storage.'
            );
        }

        const state = typeof req.query.state === 'string'
            ? req.query.state
            : '';

        if (!/^[a-f0-9]{64}$/.test(state)) {
            return res.status(400).send(
                'Invalid or expired YouTube authorization state.'
            );
        }

        const stateKey = YOUTUBE_OAUTH_STATE_PREFIX + state;
        const rawState = await redisClient.get(stateKey);

        if (!rawState) {
            return res.status(400).send(
                'Invalid or expired YouTube authorization state. Start again from Admin.'
            );
        }

        // Consume the state immediately so it cannot be reused.
        await redisClient.del(stateKey);

        if (typeof req.query.error === 'string') {
            return res.redirect(303, '/admin?youtube=cancelled');
        }

        const code = typeof req.query.code === 'string'
            ? req.query.code
            : '';

        if (!code) {
            return res.status(400).send(
                'Google did not return an authorization code.'
            );
        }

        const oauth = createYouTubeOAuthClient();

        if (!oauth) {
            return res.status(503).send(
                'YouTube OAuth environment variables are not configured.'
            );
        }

        const tokenResult = await oauth.getToken(code);
        const tokens = tokenResult.tokens || {};

        const existingRaw = await redisClient.get(
            YOUTUBE_CREDENTIALS_REDIS_KEY
        );

        let existing = null;
        if (existingRaw) {
            try {
                existing = JSON.parse(existingRaw);
            } catch {
                existing = null;
            }
        }

        const refreshToken =
            tokens.refresh_token ||
            (existing && existing.refreshToken);

        if (!refreshToken) {
            return res.redirect(303, '/admin?youtube=token-error');
        }

        // Never return or log tokens to the browser.
        const stateInfo = JSON.parse(rawState);

        await redisClient.set(
            YOUTUBE_CREDENTIALS_REDIS_KEY,
            JSON.stringify({
                refreshToken,
                connectedAt: new Date().toISOString(),
                connectedBy: stateInfo.adminUsername || ''
            })
        );

        return res.redirect(303, '/admin?youtube=connected');
    } catch (error) {
        console.error('YouTube OAuth callback failed.');
        return res.redirect(303, '/admin?youtube=error');
    }
});


const allowedMimes = new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
    'video/mp4',
    'video/quicktime',
    'video/webm'
]);

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 50 * 1024 * 1024,
        files: 20
    },
    fileFilter: (req, file, cb) => {
        if (!allowedMimes.has(file.mimetype)) {
            return cb(new Error('Unsupported file type.'));
        }

        cb(null, true);
    }
});


const MEDIA_UPLOAD_TEMP_DIR = require('path').join(
    require('os').tmpdir(),
    'puja-darshan-media-uploads'
);
fs.mkdirSync(MEDIA_UPLOAD_TEMP_DIR, { recursive: true });

function getAllowedMediaMimeType(file) {
    const mime = String(file.mimetype || '').toLowerCase();

    if (allowedMimes.has(mime)) return mime;

    if (!mime || mime === 'application/octet-stream') {
        const extension = path.extname(file.originalname || '').toLowerCase();
        const extensionMimes = {
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.png': 'image/png',
            '.webp': 'image/webp',
            '.mp4': 'video/mp4',
            '.mov': 'video/quicktime',
            '.webm': 'video/webm'
        };

        const fallback = extensionMimes[extension];
        if (fallback && allowedMimes.has(fallback)) return fallback;
    }

    return null;
}

const mediaUpload = multer({
    storage: multer.diskStorage({
        destination: (_req, _file, cb) => cb(null, MEDIA_UPLOAD_TEMP_DIR),
        filename: (_req, file, cb) => {
            const extension = path.extname(file.originalname || '')
                .toLowerCase()
                .replace(/[^.a-z0-9]/g, '')
                .slice(0, 10);
            cb(null, require('crypto').randomUUID() + extension);
        }
    }),
    limits: {
        fileSize: 1024 * 1024 * 1024,
        files: 10
    },
    fileFilter: (req, file, cb) => {
        const detectedMimeType = getAllowedMediaMimeType(file);

        if (!detectedMimeType) {
            return cb(new Error('Unsupported file type.'));
        }

        file.detectedMimeType = detectedMimeType;
        cb(null, true);
    }
});

function handleAdminMediaUpload(req, res, next) {
    mediaUpload.array('files', 10)(req, res, error => {
        if (!error) return next();

        if (error instanceof multer.MulterError &&
            error.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({
                error: 'Upload exceeds 1 GB (1024 MB). YouTube video uploads may be up to 1 GB (1024 MB); Cloudinary-only uploads remain limited to 50 MB.'
            });
        }

        if (error.message === 'Unsupported file type.') {
            return res.status(400).json({
                error: 'Allowed formats: JPG, PNG, WebP, MP4, MOV and WebM.'
            });
        }

        next(error);
    });
}

const submissionImageMimes = new Set([
    'image/jpeg',
    'image/png',
    'image/webp'
]);

const submissionImageUpload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024,
        files: 1,
        fields: 20,
        fieldSize: 10 * 1024
    },
    fileFilter: (req, file, cb) => {
        if (!submissionImageMimes.has(file.mimetype)) {
            return cb(new Error('Only JPG, PNG or WebP images are allowed.'));
        }
        cb(null, true);
    }
});

function parseSubmissionImage(req, res, next) {
    submissionImageUpload.single('image')(req, res, error => {
        if (!error) return next();

        const tooLarge =
            error instanceof multer.MulterError &&
            error.code === 'LIMIT_FILE_SIZE';

        return res.status(tooLarge ? 413 : 400).json({
            error: tooLarge
                ? 'Image must be 5 MB or smaller.'
                : (error.message || 'Image upload failed. Use JPG, PNG or WebP.')
        });
    });
}

function hasValidSubmissionImageSignature(buffer) {
    if (!Buffer.isBuffer(buffer)) return false;

    const jpeg = buffer.length >= 3 &&
        buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;

    const png = buffer.length >= 8 &&
        buffer.subarray(0, 8).equals(
            Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
        );

    const webp = buffer.length >= 12 &&
        buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
        buffer.subarray(8, 12).toString('ascii') === 'WEBP';

    return jpeg || png || webp;
}

async function uploadMandirSubmissionImage(file) {
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream({
            folder: 'puja-darshan/mandir-submissions',
            resource_type: 'image',
            tags: ['puja-darshan-pending-submission'],
            allowed_formats: ['jpg', 'jpeg', 'png', 'webp']
        }, (error, result) => {
            if (error) return reject(error);
            resolve(result);
        });

        stream.end(file.buffer);
    });
}

app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        service: 'Puja Darshan API'
    });
});

app.post('/api/auth/login', loginLimiter, async (req, res, next) => {
    try {
        const { username, password } = req.body || {};

        if (
            typeof username !== 'string' ||
            typeof password !== 'string' ||
            username.length > 100 ||
            password.length > 200
        ) {
            return res.status(400).json({
                error: 'Invalid username or password.'
            });
        }

        const usernameMatches =
            username === process.env.ADMIN_USERNAME;

        const encodedHash = await readAdminPasswordHashB64();
        const passwordHash = Buffer.from(encodedHash, "base64").toString("utf8");

        if (!/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(passwordHash)) {
            return next(new Error("Admin password hash configuration is invalid."));
        }

        const passwordMatches = await bcrypt.compare(
            password,
            passwordHash
        );

        if (!usernameMatches || !passwordMatches) {
            return res.status(401).json({
                error: 'Invalid username or password.'
            });
        }

        req.session.regenerate(err => {
            if (err) return next(err);

            req.session.isAdmin = true;
            req.session.adminUsername = process.env.ADMIN_USERNAME;
            req.session.adminPasswordHashB64 = encodedHash;

            req.session.save(err => {
                if (err) return next(err);

                res.json({
                    success: true,
                    message: 'Login successful.'
                });
            });
        });
    } catch (error) {
        next(error);
    }
});

app.post('/api/auth/change-password', passwordChangeLimiter, requireAdmin, async (req, res, next) => {
    try {
        const { currentPassword, newPassword } = req.body || {};

        if (
            typeof currentPassword !== 'string' ||
            typeof newPassword !== 'string' ||
            currentPassword.length > 200 ||
            newPassword.length > 200
        ) {
            return res.status(400).json({ error: 'Invalid password input.' });
        }

        const newPasswordBytes = Buffer.byteLength(newPassword, 'utf8');
        if (newPasswordBytes < 12 || newPasswordBytes > 72) {
            return res.status(400).json({
                error: 'New password must be 12–72 UTF-8 bytes.'
            });
        }

        const currentHashB64 = await readAdminPasswordHashB64();
        const currentHash = Buffer.from(currentHashB64, 'base64').toString('utf8');

        if (!/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(currentHash)) {
            return next(new Error('Admin password hash configuration is invalid.'));
        }

        if (!(await bcrypt.compare(currentPassword, currentHash))) {
            return res.status(400).json({ error: 'Current password is incorrect.' });
        }

        if (currentPassword === newPassword) {
            return res.status(400).json({
                error: 'Choose a new password different from the current one.'
            });
        }

        const newHash = await bcrypt.hash(newPassword, 12);
        const newHashB64 = Buffer.from(newHash, 'utf8').toString('base64');
        await writeAdminPasswordHashB64(newHashB64);

        // Destroy this session. Other old sessions also fail the password-hash check.
        req.session.destroy(error => {
            if (error) return next(error);

            res.clearCookie('pd.sid', {
                httpOnly: true,
                secure: isProduction,
                sameSite: 'strict',
                path: '/'
            });

            return res.json({
                success: true,
                message: 'Password changed. Please sign in again.'
            });
        });
    } catch (error) {
        return next(error);
    }
});

app.get('/api/auth/me', async (req, res, next) => {
    try {
        if (!(await isCurrentAdminSession(req))) {
            return res.status(401).json({ authenticated: false });
        }

        return res.json({
            authenticated: true,
            username: req.session.adminUsername
        });
    } catch (error) {
        return next(error);
    }
});

app.post('/api/auth/logout', (req, res, next) => {
    if (!req.session) {
        return res.json({ success: true });
    }

    req.session.destroy(err => {
        if (err) return next(err);

        res.clearCookie('pd.sid', {
            httpOnly: true,
            secure: isProduction,
            sameSite: 'strict',
            path: '/'
        });

        res.json({
            success: true,
            message: 'Logged out.'
        });
    });
});

app.get('/api/admin/test', requireAdmin, (req, res) => {
    res.json({
        success: true,
        message: 'Admin authentication verified.'
    });
});

// Upload one image or video to Cloudinary.

 // Upload multiple images or videos to Cloudinary.
app.post(
    '/api/admin/media',
    requireAdmin,
    handleAdminMediaUpload,
    async (req, res, next) => {
        try {
            if (!req.files || req.files.length === 0) {
                return res.status(400).json({
                    error: 'Please select at least one image or video.'
                });
            }

            const alsoUploadToYoutube =
                req.body && req.body.alsoUploadToYoutube === 'true';

            if (!alsoUploadToYoutube &&
                req.files.some(file => file.size > 50 * 1024 * 1024)) {
                return res.status(413).json({
                    error: 'Cloudinary-only uploads are limited to 50 MB per file. Enable YouTube upload for videos up to 1 GB (1024 MB).'
                });
            }

            let youtubeContext = null;

            if (alsoUploadToYoutube) {
                if (req.files.length !== 1) {
                    return res.status(400).json({
                        error: 'Select exactly one video for YouTube upload.'
                    });
                }

                const file = req.files[0];
                const allowedVideoMimes = new Set([
                    'video/mp4',
                    'video/quicktime',
                    'video/webm'
                ]);

                const videoMimeType = file.detectedMimeType || file.mimetype;

                if (!allowedVideoMimes.has(videoMimeType)) {
                    return res.status(400).json({
                        error: 'YouTube upload supports MP4, MOV and WebM videos only.'
                    });
                }

                let title = typeof req.body.youtubeTitle === 'string'
                    ? req.body.youtubeTitle.trim()
                    : '';

                if (!title) {
                    title = path.basename(
                        file.originalname || 'Puja Darshan Video',
                        path.extname(file.originalname || '')
                    ).trim().slice(0, 100);
                }

                if (!title) title = 'Puja Darshan Video';

                if (title.length > 100) {
                    return res.status(400).json({
                        error: 'YouTube title must be 100 characters or fewer.'
                    });
                }

                const description =
                    typeof req.body.youtubeDescription === 'string'
                        ? req.body.youtubeDescription
                        : '';

                if (description.length > 5000) {
                    return res.status(400).json({
                        error: 'YouTube description must be 5000 characters or fewer.'
                    });
                }

                const requestedPrivacy =
                    typeof req.body.youtubePrivacy === 'string'
                        ? req.body.youtubePrivacy
                        : 'private';

                if (!['private', 'unlisted', 'public'].includes(requestedPrivacy)) {
                    return res.status(400).json({
                        error: 'Invalid YouTube privacy setting.'
                    });
                }

                if (!redisClient) {
                    return res.status(503).json({
                        error: 'YouTube upload must run on the deployed backend.'
                    });
                }

                const oauth = createYouTubeOAuthClient();
                if (!oauth) {
                    return res.status(503).json({
                        error: 'YouTube OAuth environment variables are not configured.'
                    });
                }

                const savedRaw = await redisClient.get(
                    YOUTUBE_CREDENTIALS_REDIS_KEY
                );

                let savedCredentials = null;
                try {
                    savedCredentials = savedRaw ? JSON.parse(savedRaw) : null;
                } catch {
                    savedCredentials = null;
                }

                if (!savedCredentials ||
                    typeof savedCredentials.refreshToken !== 'string' ||
                    !savedCredentials.refreshToken) {
                    return res.status(409).json({
                        error: 'YouTube is not connected. Connect the YouTube account first.'
                    });
                }

                oauth.setCredentials({
                    refresh_token: savedCredentials.refreshToken
                });

                youtubeContext = {
                    oauth,
                    file,
                    mimeType: videoMimeType,
                    title,
                    description,
                    privacyStatus: requestedPrivacy
                };
            }

            const media = youtubeContext ? [] : await Promise.all(
                req.files.map(async (file) => {
                    const result = await new Promise((resolve, reject) => {
                        const stream = cloudinary.uploader.upload_stream(
                            {
                                folder: 'puja-darshan',
                                tags: ['puja-darshan-gallery'],
                                resource_type: 'auto'
                            },
                            (error, uploaded) => {
                                if (error) return reject(error);
                                resolve(uploaded);
                            }
                        );

                        const source = fs.createReadStream(file.path);
                        source.on('error', sourceError => {
                            stream.destroy();
                            reject(sourceError);
                        });
                        source.pipe(stream);
                    });

                    return {
                        public_id: result.public_id,
                        secure_url: result.secure_url,
                        resource_type: result.resource_type,
                        format: result.format,
                        original_filename: file.originalname,
                        created_at: result.created_at
                    };
                })
            );

            let youtubeResult = null;

            if (youtubeContext) {
                try {
                    const youtube = google.youtube({
                        version: 'v3',
                        auth: youtubeContext.oauth
                    });

                    const response = await youtube.videos.insert({
                        part: ['snippet', 'status'],
                        requestBody: {
                            snippet: {
                                title: youtubeContext.title,
                                description: youtubeContext.description,
                                categoryId: '19'
                            },
                            status: {
                                privacyStatus: youtubeContext.privacyStatus
                            }
                        },
                        media: {
                            mimeType: youtubeContext.mimeType,
                            body: fs.createReadStream(youtubeContext.file.path)
                        }
                    });

                    const videoId = response.data.id;

                    if (!videoId) {
                        throw new Error('YouTube did not return a video ID.');
                    }

                    youtubeResult = {
                        success: true,
                        videoId,
                        url: 'https://www.youtube.com/watch?v=' + videoId,
                        privacyStatus: youtubeContext.privacyStatus
                    };
                } catch (youtubeError) {
                    const googleMessage =
                        youtubeError &&
                        youtubeError.response &&
                        youtubeError.response.data &&
                        youtubeError.response.data.error &&
                        youtubeError.response.data.error.message;

                    console.error(
                        'YouTube upload failed:',
                        typeof googleMessage === 'string'
                            ? googleMessage
                            : 'API request failed.'
                    );

                    youtubeResult = {
                        success: false,
                        error: 'YouTube upload failed. No video was saved to Cloudinary. Check the YouTube API quota, authorization, and video format.'
                    };
                }
            }

            return res.status(201).json({
                success: true,
                count: media.length,
                media,
                youtube: youtubeResult
            });
        } catch (error) {
            next(error);
        } finally {
            const temporaryFiles = Array.isArray(req.files) ? req.files : [];
            await Promise.all(temporaryFiles.map(async file => {
                if (!file.path) return;
                try {
                    await fs.promises.unlink(file.path);
                } catch (unlinkError) {
                    if (unlinkError.code !== 'ENOENT') {
                        console.error('Temporary upload cleanup failed.');
                    }
                }
            }));
        }
    }
);



// List gallery items tagged by this application.
app.get('/api/admin/media', requireAdmin, async (req, res, next) => {
    try {
        const options = {
            max_results: 100,
            tags: true
        };

        const [images, videos] = await Promise.all([
            cloudinary.api.resources_by_tag(
                'puja-darshan-gallery',
                { ...options, resource_type: 'image' }
            ),
            cloudinary.api.resources_by_tag(
                'puja-darshan-gallery',
                { ...options, resource_type: 'video' }
            )
        ]);

        const media = [...images.resources, ...videos.resources]
            .sort((a, b) =>
                new Date(b.created_at) - new Date(a.created_at)
            )
            .map(item => ({
                public_id: item.public_id,
                secure_url: item.secure_url,
                resource_type: item.resource_type,
                format: item.format,
                created_at: item.created_at
            }));

        res.json({ success: true, media });
    } catch (error) {
        next(error);
    }
});

// Delete only tagged media belonging to this application's folder.
app.delete('/api/admin/media', requireAdmin, async (req, res, next) => {
    try {
        const { public_id, resource_type } = req.body || {};

        if (
            typeof public_id !== 'string' ||
            public_id.length === 0 ||
            public_id.length > 500 ||
            !['image', 'video'].includes(resource_type)
        ) {
            return res.status(400).json({
                error: 'Invalid media selection.'
            });
        }

        const asset = await cloudinary.api.resource(public_id, {
            resource_type,
            type: 'upload'
        });

        if (
            !Array.isArray(asset.tags) ||
            !asset.tags.includes('puja-darshan-gallery')
        ) {
            return res.status(403).json({
                error: 'This media is not managed by Puja Darshan.'
            });
        }

        const result = await cloudinary.uploader.destroy(public_id, {
            resource_type,
            invalidate: true
        });

        if (result.result !== 'ok') {
            return res.status(502).json({
                error: 'Cloudinary could not delete this media.'
            });
        }

        res.json({
            success: true,
            message: 'Media deleted successfully.'
        });
    } catch (error) {
        if (error.http_code === 404) {
            return res.status(404).json({
                error: 'Media not found.'
            });
        }

        next(error);
    }
});



// Public read-only feed for approved gallery media.
// Cloudinary credentials remain on the server.
const publicMediaCache = new Map();

app.get('/api/public/media', async (req, res, next) => {
    try {
        const type = typeof req.query.type === 'string'
            ? req.query.type.toLowerCase()
            : 'all';

        if (!['image', 'video', 'all'].includes(type)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid media type.'
            });
        }

        res.set('Cache-Control', 'public, max-age=60');

        const cached = publicMediaCache.get(type);
        if (cached && cached.expiresAt > Date.now()) {
            return res.json(cached.body);
        }

        const resourceTypes = type === 'all'
            ? ['image', 'video']
            : [type];

        const results = await Promise.all(
            resourceTypes.map(resourceType =>
                cloudinary.api.resources_by_tag(
                    'puja-darshan-gallery',
                    {
                        max_results: 100,
                        resource_type: resourceType
                    }
                )
            )
        );

        const media = results
            .flatMap((result, index) =>
                (Array.isArray(result.resources) ? result.resources : [])
                    .map(item => ({
                        ...item,
                        resource_type:
                            item.resource_type || resourceTypes[index]
                    }))
            )
            .filter(item =>
                resourceTypes.includes(item.resource_type) &&
                typeof item.public_id === 'string' &&
                typeof item.secure_url === 'string' &&
                item.secure_url.startsWith(
                    'https://res.cloudinary.com/'
                )
            )
            .sort((a, b) =>
                new Date(b.created_at || 0).getTime() -
                new Date(a.created_at || 0).getTime()
            )
            .map(item => ({
                public_id: item.public_id,
                secure_url: item.secure_url,
                resource_type: item.resource_type,
                format: item.format || '',
                created_at: item.created_at || '',
                width: Number.isFinite(item.width) ? item.width : null,
                height: Number.isFinite(item.height) ? item.height : null
            }));

        const body = { success: true, media };

        publicMediaCache.set(type, {
            expiresAt: Date.now() + 60000,
            body
        });

        return res.json(body);
    } catch (error) {
        next(error);
    }
});

// Mandir directory API.
function validateMandirInput(body, existing = {}) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return { error: 'Invalid Mandir data.' };
    }

    const limits = {
        name: 150,
        district: 100,
        zone: 100,
        address: 250,
        latitude: 30,
        longitude: 30,
        description: 2000,
        imageUrl: 2000
    };
    const value = {};

    for (const [field, maxLength] of Object.entries(limits)) {
        const raw = body[field] === undefined ? (existing[field] || '') : body[field];
        if (typeof raw !== 'string' || raw.length > maxLength) {
            return { error: 'Invalid ' + field + '.' };
        }
        value[field] = raw.trim();
    }

    if (!value.name) return { error: 'Mandir name is required.' };
    if (!value.district) return { error: 'District is required.' };

    if (value.imageUrl) {
        try {
            const parsed = new URL(value.imageUrl);
            if (parsed.protocol !== 'https:') {
                return { error: 'Image URL must use HTTPS.' };
            }
        } catch {
            return { error: 'Enter a valid HTTPS image URL.' };
        }
    }


    const hasLatitude = Boolean(value.latitude);
    const hasLongitude = Boolean(value.longitude);

    if (hasLatitude !== hasLongitude) {
        return { error: 'Provide both temple latitude and longitude.' };
    }

    if (hasLatitude) {
        const latitude = Number(value.latitude);
        const longitude = Number(value.longitude);

        if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
            return { error: 'Temple latitude must be between -90 and 90.' };
        }
        if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
            return { error: 'Temple longitude must be between -180 and 180.' };
        }

        value.latitude = String(latitude);
        value.longitude = String(longitude);
    }

    return { value };
}


const mandirSubmissionLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: isProduction ? 3 : 100,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many submissions. Please try again later.' }
});

function normalizeMandirKey(value) {
    return String(value || '').trim().toLowerCase();
}


const videoUploadSignLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: isProduction ? 3 : 100,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many video upload attempts. Please try again later.' }
});

const videoUploadRefreshLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: isProduction ? 180 : 1000,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many upload chunks. Please retry later.' }
});

const videoSubmissionLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: isProduction ? 3 : 100,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many video submissions. Please try again later.' }
});

function rejectVideoBot(req, res) {
    const body = req.body || {};
    if (typeof body.website === 'string' && body.website.trim()) {
        res.status(400).json({ error: 'Submission could not be accepted.' });
        return true;
    }
    return false;
}

app.post('/api/video-submissions/sign-upload', videoUploadSignLimiter, async (req, res, next) => {
    try {
        if (rejectVideoBot(req, res)) return;

        const body = req.body || {};
        const fileName = typeof body.fileName === 'string'
            ? body.fileName.replace(/[\\/]/g, '_').slice(0, 180)
            : '';
        const fileSize = Number(body.fileSize);
        const extension = path.extname(fileName).toLowerCase();

        if (!['.mp4', '.mov', '.webm'].includes(extension)) {
            return res.status(400).json({
                error: 'Choose an MP4, MOV or WebM video.'
            });
        }

        if (!Number.isSafeInteger(fileSize) ||
            fileSize < 1 ||
            fileSize > MAX_VIDEO_SUBMISSION_BYTES) {
            return res.status(413).json({
                error: 'Video must be 1 GB or smaller.'
            });
        }

        const id = require('crypto').randomUUID();
        const publicId = 'visitor_video_' +
            require('crypto').randomUUID().replace(/-/g, '');

        const ticket = {
            id,
            publicId,
            fileName,
            fileSize,
            folder: VIDEO_SUBMISSION_FOLDER,
            tags: VIDEO_SUBMISSION_TAG,
            deliveryType: VIDEO_SUBMISSION_TYPE,
            createdAt: Date.now()
        };

        await saveVideoUploadTicket(ticket);
        const signed = createVideoUploadSignature(ticket);

        res.set('Cache-Control', 'no-store');
        return res.status(201).json({
            success: true,
            ticketId: id,
            uploadId: id,
            maxBytes: MAX_VIDEO_SUBMISSION_BYTES,
            ...signed
        });
    } catch (error) {
        next(error);
    }
});

app.post('/api/video-submissions/refresh-signature', videoUploadRefreshLimiter, async (req, res, next) => {
    try {
        const body = req.body || {};
        const id = typeof body.ticketId === 'string' ? body.ticketId : '';

        if (!/^[a-f0-9-]{36}$/i.test(id)) {
            return res.status(400).json({ error: 'Invalid upload session.' });
        }

        const ticket = await getVideoUploadTicket(id);
        if (!ticket) {
            return res.status(410).json({
                error: 'Upload session expired. Please start again.'
            });
        }

        res.set('Cache-Control', 'no-store');
        return res.json({
            success: true,
            ticketId: ticket.id,
            uploadId: ticket.id,
            maxBytes: MAX_VIDEO_SUBMISSION_BYTES,
            ...createVideoUploadSignature(ticket)
        });
    } catch (error) {
        next(error);
    }
});

app.post('/api/video-submissions', videoSubmissionLimiter, async (req, res, next) => {
    let ticket = null;

    try {
        if (rejectVideoBot(req, res)) return;

        const body = req.body || {};
        const ticketId = typeof body.ticketId === 'string' ? body.ticketId : '';
        const publicId = typeof body.public_id === 'string' ? body.public_id : '';

        if (!/^[a-f0-9-]{36}$/i.test(ticketId) || !publicId || publicId.length > 500) {
            return res.status(400).json({ error: 'Invalid video upload session.' });
        }

        ticket = await getVideoUploadTicket(ticketId);
        if (!ticket) {
            return res.status(410).json({
                error: 'Upload session expired. Please upload again.'
            });
        }

        if (publicId !== ticket.publicId &&
            !publicId.endsWith('/' + ticket.publicId)) {
            return res.status(403).json({
                error: 'The uploaded video does not match this upload session.'
            });
        }

        const title = typeof body.title === 'string' ? body.title.trim() : '';
        const description = typeof body.description === 'string'
            ? body.description.trim()
            : '';
        const mandirName = typeof body.mandirName === 'string'
            ? body.mandirName.trim()
            : '';
        const district = typeof body.district === 'string'
            ? body.district.trim()
            : '';
        const submitterName = typeof body.submitterName === 'string'
            ? body.submitterName.trim()
            : '';
        const contact = typeof body.contact === 'string'
            ? body.contact.trim()
            : '';

        if (title.length < 3 || title.length > 100 ||
            description.length > 2000 ||
            mandirName.length < 2 || mandirName.length > 150 ||
            district.length < 2 || district.length > 80 ||
            submitterName.length > 100 ||
            contact.length > 150 ||
            body.rightsConsent !== true) {
            return res.status(400).json({
                error: 'Check the title, mandir, district and publication permission fields.'
            });
        }

        const extension = path.extname(ticket.fileName).toLowerCase();
        const asset = await cloudinary.api.resource(publicId, {
            resource_type: 'video',
            type: VIDEO_SUBMISSION_TYPE
        });

        if (asset.resource_type !== 'video' ||
            !Array.isArray(asset.tags) ||
            !asset.tags.includes(VIDEO_SUBMISSION_TAG) ||
            !['mp4', 'mov', 'webm'].includes(String(asset.format).toLowerCase()) ||
            !Number.isFinite(Number(asset.bytes)) ||
            Number(asset.bytes) < 1 ||
            Number(asset.bytes) > MAX_VIDEO_SUBMISSION_BYTES) {
            return res.status(400).json({
                error: 'The uploaded asset did not pass video validation.'
            });
        }

        const submissions = await readVideoSubmissions();
        if (submissions.some(item => item.publicId === asset.public_id)) {
            return res.status(409).json({
                error: 'This video has already been submitted.'
            });
        }

        const submission = {
            id: require('crypto').randomUUID(),
            status: 'pending',
            title,
            description,
            mandirName,
            district,
            submitterName,
            contact,
            originalFilename: ticket.fileName,
            publicId: asset.public_id,
            resourceType: 'video',
            deliveryType: VIDEO_SUBMISSION_TYPE,
            bytes: Number(asset.bytes),
            format: String(asset.format).toLowerCase(),
            duration: Number.isFinite(Number(asset.duration))
                ? Number(asset.duration)
                : null,
            rightsConsent: true,
            consentAt: new Date().toISOString(),
            submittedAt: new Date().toISOString()
        };

        submissions.unshift(submission);

        try {
            await writeVideoSubmissions(submissions);
        } catch (storageError) {
            try {
                await cloudinary.uploader.destroy(asset.public_id, {
                    resource_type: 'video',
                    type: VIDEO_SUBMISSION_TYPE,
                    invalidate: true
                });
            } catch (cleanupError) {
                console.error('Pending video cleanup failed.');
            }
            throw storageError;
        }

        await deleteVideoUploadTicket(ticketId);

        return res.status(201).json({
            success: true,
            message: 'Video received. It remains private and pending admin review.',
            submissionId: submission.id
        });
    } catch (error) {
        next(error);
    }
});


// Admin review queue for visitor video submissions.
app.get('/api/admin/video-submissions', requireAdmin, async (req, res, next) => {
    try {
        const submissions = await readVideoSubmissions();
        res.json({
            success: true,
            submissions: submissions.filter(item => item.status === 'pending')
        });
    } catch (error) {
        next(error);
    }
});


 // Stream pending authenticated videos only to a signed-in admin.
app.get('/api/admin/video-submissions/:id/preview', requireAdmin, async (req, res, next) => {
    try {
        const submissions = await readVideoSubmissions();

        const item = submissions.find(
            x => x.id === req.params.id && x.status === 'pending'
        );

        if (!item) {
            return res.status(404).json({
                error: 'Pending video not found.'
            });
        }

        const url = cloudinary.url(item.publicId, {
            resource_type: 'video',
            type: 'authenticated',
            format: item.format || 'mp4',
            sign_url: true,
            secure: true
        });

        const headers = {};

        if (req.headers.range) {
            headers.Range = req.headers.range;
        }

        const upstream = await fetch(url, { headers });

        if (!upstream.ok && upstream.status !== 206) {
            console.error('Cloudinary preview upstream failed:', {
                status: upstream.status,
                contentType: upstream.headers.get('content-type')
            });

            await upstream.body?.cancel();

            return res.status(502).json({
                error: 'Private video preview could not be loaded from Cloudinary.'
            });
        }

        res.status(upstream.status);

        for (const name of [
            'content-type',
            'content-length',
            'content-range',
            'accept-ranges'
        ]) {
            const value = upstream.headers.get(name);

            if (value) {
                res.setHeader(name, value);
            }
        }

        res.setHeader('Cache-Control', 'private, no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');

        if (!upstream.body) {
            return res.end();
        }

        res.on('close', () => {
            if (!res.writableEnded) {
                upstream.body.cancel().catch(() => {});
            }
        });

        require('node:stream').Readable
            .fromWeb(upstream.body)
            .pipe(res);
    } catch (error) {
        next(error);
    }
});

app.post('/api/admin/video-submissions/:id/approve', requireAdmin, async (req, res, next) => {
    try {
        const submissions = await readVideoSubmissions();
        const index = submissions.findIndex(item => item.id === req.params.id);
        if (index === -1) return res.status(404).json({ error: 'Video submission not found.' });

        const submission = submissions[index];
        if (submission.status !== 'pending') {
            return res.status(409).json({ error: 'This video has already been reviewed.' });
        }

        const targetPublicId = 'puja-darshan/approved-videos/' + submission.id;
        let renamed;
        try {
            renamed = await cloudinary.uploader.rename(
                submission.publicId,
                targetPublicId,
                {
                    resource_type: 'video',
                    type: VIDEO_SUBMISSION_TYPE,
                    to_type: 'upload',
                    overwrite: false,
                    invalidate: true,
                    tags: 'puja-darshan-gallery',
                    context: {
                        title: submission.title,
                        description: submission.description || '',
                        mandir: submission.mandirName,
                        district: submission.district,
                        submitter: submission.submitterName || ''
                    }
                }
            );
        } catch (error) {
            if (error.http_code === 404) {
                return res.status(404).json({ error: 'The pending Cloudinary video was not found.' });
            }
            throw error;
        }

        submissions[index] = {
            ...submission,
            status: 'approved',
            publicId: renamed.public_id || targetPublicId,
            deliveryType: 'upload',
            approvedAt: new Date().toISOString()
        };

        try {
            await writeVideoSubmissions(submissions);
        } catch (storageError) {
            // Best-effort rollback: keep the approved Cloudinary asset private from the public gallery.
            try {
                await cloudinary.uploader.destroy(targetPublicId, {
                    resource_type: 'video',
                    type: 'upload',
                    invalidate: true
                });
            } catch (_) {}
            throw storageError;
        }

        publicMediaCache.clear();
        res.json({ success: true, message: 'Video approved and published.', submission: submissions[index] });
    } catch (error) {
        next(error);
    }
});

app.delete('/api/admin/video-submissions/:id', requireAdmin, async (req, res, next) => {
    try {
        const submissions = await readVideoSubmissions();
        const index = submissions.findIndex(item => item.id === req.params.id);
        if (index === -1) return res.status(404).json({ error: 'Video submission not found.' });

        const submission = submissions[index];
        if (submission.status !== 'pending') {
            return res.status(409).json({ error: 'Only pending video submissions can be rejected here.' });
        }

        try {
            await cloudinary.uploader.destroy(submission.publicId, {
                resource_type: 'video',
                type: submission.deliveryType || VIDEO_SUBMISSION_TYPE,
                invalidate: true
            });
        } catch (error) {
            if (error.http_code !== 404) throw error;
        }

        submissions.splice(index, 1);
        await writeVideoSubmissions(submissions);
        res.json({ success: true, message: 'Video submission rejected and removed.' });
    } catch (error) {
        next(error);
    }
});


app.post('/api/mandir-submissions', mandirSubmissionLimiter, parseSubmissionImage, async (req, res, next) => {
    try {
        const body = req.body || {};

        // Hidden field used as a basic bot honeypot.
        if (typeof body.website === 'string' && body.website.trim()) {
            return res.status(400).json({ error: 'Submission could not be accepted.' });
        }

        if (req.file && typeof body.imageUrl === 'string' && body.imageUrl.trim()) {
            return res.status(400).json({
                error: 'Choose either an uploaded photo or an image URL, not both.'
            });
        }

        const checked = validateMandirInput(body);
        if (checked.error) {
            return res.status(400).json({ error: checked.error });
        }

        let submitterLocation = null;
        let rawSubmitterLocation = body.submitterLocation;

        if (typeof rawSubmitterLocation === 'string') {
            if (!rawSubmitterLocation.trim()) {
                rawSubmitterLocation = null;
            } else {
                try {
                    rawSubmitterLocation = JSON.parse(rawSubmitterLocation);
                } catch {
                    return res.status(400).json({ error: 'Invalid shared location.' });
                }
            }
        }

        if (rawSubmitterLocation !== undefined && rawSubmitterLocation !== null) {
            const loc = rawSubmitterLocation;

            if (!loc || typeof loc !== 'object' || Array.isArray(loc)) {
                return res.status(400).json({ error: 'Invalid shared location.' });
            }

            const latitude = Number(loc.latitude);
            const longitude = Number(loc.longitude);
            const accuracy = loc.accuracy == null ? null : Number(loc.accuracy);

            if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
                !Number.isFinite(longitude) || longitude < -180 || longitude > 180 ||
                (accuracy !== null && (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > 100000))) {
                return res.status(400).json({ error: 'Invalid shared location coordinates.' });
            }

            submitterLocation = {
                latitude,
                longitude,
                accuracy,
                sharedAt: new Date().toISOString()
            };
        }

        const [mandirs, submissions] = await Promise.all([
            readMandirs(),
            readMandirSubmissions()
        ]);

        const nameKey = normalizeMandirKey(checked.value.name);
        const districtKey = normalizeMandirKey(checked.value.district);
        const alreadyExists = [...mandirs, ...submissions].some(item =>
            normalizeMandirKey(item.name) === nameKey &&
            normalizeMandirKey(item.district) === districtKey
        );

        if (alreadyExists) {
            return res.status(409).json({
                error: 'A mandir with this name and district is already listed or awaiting review.'
            });
        }

        let uploadedImage = null;

        if (req.file) {
            if (!hasValidSubmissionImageSignature(req.file.buffer)) {
                return res.status(400).json({
                    error: 'The selected file is not a valid JPG, PNG or WebP image.'
                });
            }

            uploadedImage = await uploadMandirSubmissionImage(req.file);
        }

        const submission = {
            id: require('crypto').randomUUID(),
            ...checked.value,
            ...(uploadedImage ? {
                imageUrl: uploadedImage.secure_url,
                imagePublicId: uploadedImage.public_id
            } : {}),
            ...(submitterLocation ? { submitterLocation } : {}),
            submittedAt: new Date().toISOString()
        };

        submissions.unshift(submission);

        try {
            await writeMandirSubmissions(submissions);
        } catch (storageError) {
            if (uploadedImage && uploadedImage.public_id) {
                try {
                    await cloudinary.uploader.destroy(
                        uploadedImage.public_id,
                        { resource_type: 'image' }
                    );
                } catch (cleanupError) {
                    console.error('Pending image cleanup failed:', cleanupError.message);
                }
            }
            throw storageError;
        }

        return res.status(201).json({
            success: true,
            message: 'Submission received for admin review.'
        });
    } catch (error) {
        return next(error);
    }
});

app.get('/api/admin/mandir-submissions', requireAdmin, async (req, res, next) => {
    try {
        const submissions = await readMandirSubmissions();
        res.set('Cache-Control', 'no-store');
        res.json({ success: true, submissions });
    } catch (error) {
        next(error);
    }
});

app.post('/api/admin/mandir-submissions/:id/approve', requireAdmin, async (req, res, next) => {
    try {
        const submissions = await readMandirSubmissions();
        const index = submissions.findIndex(item => item.id === req.params.id);

        if (index === -1) {
            return res.status(404).json({ error: 'Submission not found.' });
        }

        const checked = validateMandirInput(submissions[index]);
        if (checked.error) {
            return res.status(400).json({ error: checked.error });
        }

        const mandirs = await readMandirs();
        const nameKey = normalizeMandirKey(checked.value.name);
        const districtKey = normalizeMandirKey(checked.value.district);

        const duplicate = mandirs.some(item =>
            normalizeMandirKey(item.name) === nameKey &&
            normalizeMandirKey(item.district) === districtKey
        );

        if (duplicate) {
            return res.status(409).json({
                error: 'A mandir with this name and district already exists. Reject this duplicate submission if appropriate.'
            });
        }

        const now = new Date().toISOString();
        const mandir = {
            id: require('crypto').randomUUID(),
            ...checked.value,
            createdAt: now,
            updatedAt: now
        };

        mandirs.push(mandir);
        await writeMandirs(mandirs);

        submissions.splice(index, 1);
        await writeMandirSubmissions(submissions);

        return res.status(201).json({
            success: true,
            message: 'Submission approved and published.',
            mandir
        });
    } catch (error) {
        next(error);
    }
});

app.delete('/api/admin/mandir-submissions/:id', requireAdmin, async (req, res, next) => {
    try {
        const submissions = await readMandirSubmissions();
        const index = submissions.findIndex(item => item.id === req.params.id);

        if (index === -1) {
            return res.status(404).json({ error: 'Submission not found.' });
        }

        const rejectedSubmission = submissions[index];
        submissions.splice(index, 1);
        await writeMandirSubmissions(submissions);

        if (rejectedSubmission.imagePublicId) {
            try {
                await cloudinary.uploader.destroy(
                    rejectedSubmission.imagePublicId,
                    { resource_type: 'image' }
                );
            } catch (cleanupError) {
                console.error('Rejected submission image cleanup failed:', cleanupError.message);
            }
        }

        res.json({ success: true, message: 'Submission rejected.' });
    } catch (error) {
        next(error);
    }
});

app.get('/api/mandirs', async (req, res, next) => {
    try {
        res.set('Cache-Control', 'no-store');
        const mandirs = await readMandirs();
        res.json({ success: true, mandirs });
    } catch (error) {
        next(error);
    }
});

app.post('/api/admin/mandirs', requireAdmin, async (req, res, next) => {
    try {
        const checked = validateMandirInput(req.body || {});
        if (checked.error) return res.status(400).json({ error: checked.error });

        const mandirs = await readMandirs();
        const now = new Date().toISOString();
        const mandir = {
            id: require('crypto').randomUUID(),
            ...checked.value,
            createdAt: now,
            updatedAt: now
        };
        mandirs.push(mandir);
        await writeMandirs(mandirs);
        res.status(201).json({ success: true, mandir });
    } catch (error) {
        next(error);
    }
});

app.put('/api/admin/mandirs/:id', requireAdmin, async (req, res, next) => {
    try {
        const mandirs = await readMandirs();
        const index = mandirs.findIndex(item => item.id === req.params.id);
        if (index === -1) return res.status(404).json({ error: 'Mandir not found.' });

        const checked = validateMandirInput(req.body || {}, mandirs[index]);
        if (checked.error) return res.status(400).json({ error: checked.error });

        mandirs[index] = {
            ...mandirs[index],
            ...checked.value,
            updatedAt: new Date().toISOString()
        };
        await writeMandirs(mandirs);
        res.json({ success: true, mandir: mandirs[index] });
    } catch (error) {
        next(error);
    }
});

app.delete('/api/admin/mandirs/:id', requireAdmin, async (req, res, next) => {
    try {
        const mandirs = await readMandirs();
        const index = mandirs.findIndex(item => item.id === req.params.id);
        if (index === -1) return res.status(404).json({ error: 'Mandir not found.' });

        mandirs.splice(index, 1);
        await writeMandirs(mandirs);
        res.json({ success: true, message: 'Mandir deleted successfully.' });
    } catch (error) {
        next(error);
    }
});

// Handle upload and other request errors safely.
app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);

    if (err instanceof multer.MulterError) {
        const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;

        return res.status(status).json({
            error: err.code === 'LIMIT_FILE_SIZE'
                ? 'File exceeds the 1 GB (1024 MB) server limit. Cloudinary-only uploads remain limited to 50 MB.'
                : 'Upload rejected. Please check the selected file.'
        });
    }

    if (err.message === 'Unsupported file type.') {
        return res.status(400).json({
            error: 'Allowed formats: JPG, PNG, WebP, MP4, MOV and WebM.'
        });
    }

    console.error('API request failed:', err);
    res.status(500).json({
        error: 'Internal server error.'
    });
});

app.use((req, res) => {
    res.status(404).json({
        error: 'Not found.'
    });
});


async function startServer() {
    try {
        if (redisClient) {
            await redisClient.connect();
            console.log('Redis connected successfully.');
        }

        app.listen(PORT, '0.0.0.0', () => {
            console.log(
                `Puja Darshan API running on port ${PORT}`
            );
        });
    } catch (err) {
        console.error('Failed to start server:', err);
        process.exit(1);
    }
}

startServer();
