const router = require('express-promise-router')();
const imageController = require('../controllers/Image');

router.route('/').post(imageController.uploadImage);

module.exports = router