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
app.use(helmet());

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
    upload.array('files', 10),
    async (req, res, next) => {
        try {
            if (!req.files || req.files.length === 0) {
                return res.status(400).json({
                    error: 'Please select at least one image or video.'
                });
            }

            const media = await Promise.all(
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

                        stream.end(file.buffer);
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

            res.status(201).json({
                success: true,
                count: media.length,
                media
            });
        } catch (error) {
            next(error);
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
                ? 'File size must not exceed 50 MB.'
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
