
require('dotenv').config({
    path: require('path').join(__dirname, '.env')
});

const cloudinary = require('cloudinary').v2;

const requiredVariables = [
    'CLOUDINARY_CLOUD_NAME',
    'CLOUDINARY_API_KEY',
    'CLOUDINARY_API_SECRET'
];

const missing = requiredVariables.filter(
    name => !process.env[name]
);

if (missing.length > 0) {
    console.error('Missing Cloudinary configuration in backend/.env');
    process.exit(1);
}

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

cloudinary.api.ping()
    .then(() => {
        console.log('Cloudinary connection successful!');
        console.log('Backend credentials are working.');
    })
    .catch(() => {
        console.error(
            'Cloudinary connection failed. Check your credentials locally.'
        );
        process.exitCode = 1;
    });