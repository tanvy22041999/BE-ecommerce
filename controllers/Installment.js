const Installment = require('../models/Installment');
const Notification = require('../models/Notification');
const Product = require('../models/Product');
const User = require('../models/User');
const Validator = require('../validators/validator');
const CronJob = require('cron').CronJob;

const getAllInstallment = async (req, res, next) => {
	try {
    let condition = {};
    if (req.query.active != undefined && req.query.active != '') {
			condition.active = req.query.active == '1' ? true : false;
    }
    if (req.query.status != undefined && req.query.status != '') {
			condition.status = req.query.status;
    }
    if (req.query.period != undefined && req.query.period != '') {
			condition.period = req.query.period;
    }
    if (req.query.user != undefined && req.query.user != '') {
			condition.user = req.query.user;
    }
    if (req.query.product != undefined && req.query.product != '') {
			condition['product._id'] = req.query.product
    }
    let limit = 10;
		let page = 0;
		if (req.query.limit != undefined && req.query.limit != '') {
			const number_limit = parseInt(req.query.limit);
			if (number_limit && number_limit > 0) {
				limit = number_limit;
			}
		}
		if (req.query.page != undefined && req.query.page != '') {
			const number_page = parseInt(req.query.page);
			if (number_page && number_page > 0) {
				page = number_page;
			}
    }
    const total = await Installment.countDocuments(condition);
    const installments = await Installment.find(condition, {user: 1, product: 1, startedAt: 1, endedAt: 1, status: 1, debt: 1, paid: 1, prepay: 1, active: 1})
    .populate({ path: 'user', select: ["image", "firstname", "lastname", "phonenumber"], populate : {path : 'image', select: "public_url"} })
    .populate({ path: 'staff', select: ["image", "firstname", "lastname"], populate : {path : 'image', select: "public_url"} })
    .populate({ path: 'product.color', select: "name_vn"})
    .populate({ path: 'product._id', select: ["bigimage", "name"], populate : {path : 'bigimage', select: "public_url"}})
    .sort({ createdAt: -1 })
    .limit(limit)
		.skip(limit * page);
		return res.status(200).json({ success: true, code: 200, message: '', total, installments });
	} catch (error) {
		return next(error);
	}
};

const addInstallment = async (req, res, next) => {
  try {
    var { startedAt, period, prepay , interest_rate, product } = req.body;
    period = parseInt(period);
    const installment = new Installment(req.body);
    if(startedAt && period){  // Xu???t ng??y ????o h???n
      const _startedAt = new Date(startedAt);
      installment.endedAt = new Date(_startedAt.setMonth(_startedAt.getMonth() + period))
      if(prepay && interest_rate){  // Xu???t ti???n n???, detail
        var debt = Math.ceil(((product.product_price-prepay )*(1 + interest_rate*0.01))/1000)* 1000
        var detail = []
        for(let i=0; i<period; i++){
          const due_date = new Date(_startedAt.setMonth(_startedAt.getMonth() + 1 + i))
          detail[i] = {
            month: i+1,
            due_date,
            payable: parseInt(debt/period),
            status: 0
          }
        }
        installment.debt = debt;
        installment.detail = detail
      }
    }
    await installment.save();
    if(startedAt){
      // Sau 1 th??ng, n???u t???i h???n tr??? g??p m?? detailItem.status v???n c??n l?? 0 (ch??a t???i h???n) th?? 
      // ?????t l???i detailItem.status l?? -1 (qu?? h???n)
      const _startedAt = new Date(startedAt);
      const expire = new Date(_startedAt.setMonth(_startedAt.getMonth() + period));
      var job = new CronJob( `${_startedAt.getMinutes()} ${_startedAt.getHours()} * * *`, 
        async() => {
          //M???i ng??y, ch???y ki???m tra xem h??m nay ???? t???i h???n tr??? ch??a?
          const thisTime = new Date();
          const installmentNow = await Installment.findById(installment._id);
          // Th??ng b??o khi ????n h???t h???n
          const productInstallment = await Product.findById(installment.product._id)
          const staffInstallment = await User.findById(installment.staff)
          const userInstallment = await User.findById(installment.user)
          installmentNow.detail.map(async item => {
            var due_date = new Date(item.due_date); // Ng??y t???i h???n
            var due_pay = item.payable*item.month;  // S??? ti???n ph???i tr??? = payable*s??? th??ng
            if(due_date >= thisTime && installment.paid < due_pay){  
              // N???u qu?? h???n v?? s??? ti???n ???? tr??? ??t h??n s??? ti???n ph???i tr??? (status = -1) -> qu?? h???n
              item.status = -1;
              installmentNow.status = 2;
              // 1. Th??ng b??o cho ng?????i d??ng
              await Notification.insert({
                name: `Phi???u tr??? g??p ${installment._id} ???? qu?? h???n`,
                link: installment._id,
                user: installment.user,
                image: productInstallment.bigimage,
                type: 2,
                content: `H??y li??n h??? v???i nh??n vi??n ph??? tr??ch ${staffInstallment.firstname} ${staffInstallment.lastname} qua s??? ??i???n tho???i ${staffInstallment.phonenumber} ho???c email ${staffInstallment.email} ????? ki???m tra v?? x??c th???c t??nh tr???ng tr??? g??p`
              })
              // 2. Th??ng b??o cho admin
              await Notification.insert({
                name: `Phi???u tr??? g??p ${installment._id} ???? qu?? h???n`,
                link: installment._id,
                user: null,
                image: productInstallment.bigimage,
                type: 2,
                content: `H??y li??n h??? v???i kh??ch h??ng ${userInstallment.firstname} ${userInstallment.lastname} qua s??? ??i???n tho???i ${userInstallment.phonenumber} ho???c email ${userInstallment.email} ????? ki???m tra v?? x??c th???c t??nh tr???ng tr??? g??p`
              })
              await job.stop();
            }
            // N???u c??n 5 ng??y n???a th?? t???i h???n, g???i th??ng b??o cho user + mail m???i ng??y
            if((due_date - thisTime > 1 || due_date - thisTime < 5) && installment.paid < due_pay){
              // 1. Th??ng b??o cho ng?????i d??ng
              await Notification.insert({
                name: `Phi???u tr??? g??p ${installment._id} c??n ${due_date - thisTime} ng??y ????? thanh to??n`,
                link: installment._id,
                user: installment.user,
                image: productInstallment.bigimage,
                type: 2,
                content: `H??y ?????n chi nh??nh c???a TellMe ????? ti???n h??nh tr??? g??p tr?????c ng??y ${due_date} ho???c thanh to??n online th??ng qua Paypal tr??n Trang c?? nh??n c???a b???n tr??n TellMe`
              })
              // 2. Th??ng b??o cho admin
              await Notification.insert({
                name: `Phi???u tr??? g??p ${installment._id} c??n ${due_date - thisTime} ng??y ????? thanh to??n`,
                link: installment._id,
                user: null,
                image: productInstallment.bigimage,
                type: 2,
                content: `H??y li??n h??? v???i kh??ch h??ng ${userInstallment.firstname} ${userInstallment.lastname} qua s??? ??i???n tho???i ${userInstallment.phonenumber} ho???c email ${userInstallment.email} ????? ki???m tra v?? x??c th???c t??nh tr???ng tr??? g??p`
              })

            }
          })
          await installmentNow.save();
          // Ki???m tra ???? h???t h???n th?? d???ng Job
          if(expire >= thisTime){
            await job.stop();
          }
        },async () => {
          
        },
        true, /* Start the job right now */
        'Asia/Ho_Chi_Minh' /* Time zone of this job. */
      );
    }
    
    return res.status(200).json({ success: true, code: 201, message: '', installment });
  } catch (error) {
    return next(error);
  }
};

const updateInstallment = async (req, res, next) => {
  try {
    const { IDInstallment } = req.params;
    const { money, status, startedAt, period, prepay, interest_rate, active, staff } = req.body;
    const installment = await Installment.findById(IDInstallment);
    if (!installment) {
      return res.status(200).json({ success: false, code: 400, message: 'id installment is not correctly' });
    }
    if(status) {
      if(status == 0 && installment.status == -1){  // N???u t??? ch??a duy???t chuy???n sang ch??a ho??n t???t -> gi???m s??? l?????ng sp
        const productFound = await Product.findById(installment.product._id)
        productFound.colors.find(i => i._id == installment.product.color.toString()).amount -= 1;
        await productFound.save();
      }
      installment.status = status;
    }
    if(staff) installment.staff = staff;
    if(active == false && installment.status == -1) installment.active = active;
    if(money > 0){
      installment.paid += parseInt(money)
      if(installment.debt - parseInt(money) <= 0){
        installment.debt = 0;
        installment.status = 1;
      }
      else{
        installment.debt -= parseInt(money);
      }
      var _money = installment.paid
      installment.detail.map(item => {
        if(_money >= item.payable){
          item.status = 1;
          _money -= item.payable;
        }
      })
    }
    if(installment.detail.length == 0){
      if(prepay && interest_rate){  // Xu???t ti???n n???, detail
        var debt = Math.ceil(((installment.product.product_price-prepay )*(1 + interest_rate*0.01))/1000)* 1000
        var detail = []
        for(let i=0; i<period; i++){
          const _startedAt = new Date(startedAt);
          const due_date = new Date(_startedAt.setMonth(_startedAt.getMonth() + 1 + i))
          detail[i] = {
            month: i+1,
            due_date,
            payable: parseInt(debt/period),
            status: 0
          }
        }
        installment.debt = debt;
        installment.detail = detail
      }
    }
    if(installment.startedAt == undefined && startedAt){
      installment.startedAt = startedAt;
      // Sau 1 th??ng, n???u t???i h???n tr??? g??p m?? detailItem.status v???n c??n l?? 0 (ch??a t???i h???n) th?? 
      // ?????t l???i detailItem.status l?? -1 (qu?? h???n)
      const _startedAt = new Date(startedAt);
      const expire = new Date(_startedAt.setMonth(_startedAt.getMonth() + period));
      installment.endedAt = expire;
      var job = new CronJob(`${_startedAt.getMinutes()} ${_startedAt.getHours()} * * *`, 
        async() => {
          const thisTime = new Date();
          const installmentNow = await Installment.findById(installment._id);
          // Th??ng b??o khi ????n h???t h???n
          const productInstallment = await Product.findById(installment.product._id)
          const staffInstallment = await User.findById(installment.staff)
          const userInstallment = await User.findById(installment.user)
          installmentNow.detail.map(async item => {
            var due_date = new Date(item.due_date); // Ng??y t???i h???n
            var due_pay = item.payable*item.month;  // S??? ti???n ph???i tr??? = payable*s??? th??ng
            if(due_date >= thisTime && installment.paid < due_pay){  
              // N???u qu?? h???n v?? s??? ti???n ???? tr??? ??t h??n s??? ti???n ph???i tr??? (status = -1) -> qu?? h???n
              item.status = -1;
              installmentNow.status = 2;
              // 1. Th??ng b??o cho ng?????i d??ng
              await Notification.insert({
                name: `Phi???u tr??? g??p ${installment._id} ???? qu?? h???n`,
                link: installment._id,
                user: installment.user,
                image: productInstallment.bigimage,
                type: 2,
                content: `H??y li??n h??? v???i nh??n vi??n ph??? tr??ch ${staffInstallment.firstname} ${staffInstallment.lastname} qua s??? ??i???n tho???i ${staffInstallment.phonenumber} ho???c email ${staffInstallment.email} ????? ki???m tra v?? x??c th???c t??nh tr???ng tr??? g??p`
              })
              // 2. Th??ng b??o cho admin
              await Notification.insert({
                name: `Phi???u tr??? g??p ${installment._id} ???? qu?? h???n`,
                link: installment._id,
                user: null,
                image: productInstallment.bigimage,
                type: 2,
                content: `H??y li??n h??? v???i kh??ch h??ng ${userInstallment.firstname} ${userInstallment.lastname} qua s??? ??i???n tho???i ${userInstallment.phonenumber} ho???c email ${userInstallment.email} ????? ki???m tra v?? x??c th???c t??nh tr???ng tr??? g??p`
              })
              await job.stop();
            }
            // N???u c??n 5 ng??y n???a th?? t???i h???n, g???i th??ng b??o cho user + mail m???i ng??y
            if((due_date - thisTime > 1 || due_date - thisTime < 5) && installment.paid < due_pay){
              // 1. Th??ng b??o cho ng?????i d??ng
              await Notification.insert({
                name: `Phi???u tr??? g??p ${installment._id} c??n ${due_date - thisTime} ng??y ????? thanh to??n`,
                link: installment._id,
                user: installment.user,
                image: productInstallment.bigimage,
                type: 2,
                content: `H??y ?????n chi nh??nh c???a TellMe ????? ti???n h??nh tr??? g??p tr?????c ng??y ${due_date} ho???c thanh to??n online th??ng qua Paypal tr??n Trang c?? nh??n c???a b???n tr??n TellMe`
              })
              // 2. Th??ng b??o cho admin
              await Notification.insert({
                name: `Phi???u tr??? g??p ${installment._id} c??n ${due_date - thisTime} ng??y ????? thanh to??n`,
                link: installment._id,
                user: null,
                image: productInstallment.bigimage,
                type: 2,
                content: `H??y li??n h??? v???i kh??ch h??ng ${userInstallment.firstname} ${userInstallment.lastname} qua s??? ??i???n tho???i ${userInstallment.phonenumber} ho???c email ${userInstallment.email} ????? ki???m tra v?? x??c th???c t??nh tr???ng tr??? g??p`
              })

            }
          })
          await installmentNow.save();
          // Ki???m tra ???? h???t h???n th?? d???ng Job
          if(expire >= thisTime){
            await job.stop();
          }
          
        },async () => {
          // K???t th??c tr??? g??p kh??ng l??m g?? c???
        },
        true, /* Start the job right now */
        'Asia/Ho_Chi_Minh' /* Time zone of this job. */
      );
    }
    await installment.save()
    return res.status(200).json({ success: true, code: 200, message: '', installment });
  } catch (error) {
    return next(error);
  }
};

const deleteInstallment = async (req, res, next) => {
  try {
    const { IDInstallment } = req.params;
    const isValid = await Validator.isValidObjId(IDInstallment);
    if (!isValid) {
      return res.status(200).json({ success: false, code: 400, message: 'id installment is not correctly' });
    } else {
      const result = await Installment.findByIdAndDelete(IDInstallment);
      if (result) return res.status(200).json({ success: true, code: 200, message: '' });
    }
  } catch (error) {
    return next(error);
  }
};

const getDetailInstallment = async (req, res, next) => {
  try {
    const { IDInstallment } = req.params;
    const isValid = await Validator.isValidObjId(IDInstallment);
    if (!isValid) {
      return res.status(200).json({ success: false, code: 400, message: 'id installment is not correctly' });
    } else {
      const result = await Installment.findById(IDInstallment)
      .populate({ path: 'user', select: ["image", "firstname", "lastname"], populate : {path : 'image', select: "public_url"} })
      .populate({ path: 'staff', select: ["image", "firstname", "lastname", "phonenumber"], populate : {path : 'image', select: "public_url"} })
      .populate({ path: 'product.color', select: "name_vn"})
      .populate({ path: 'product._id', select: ["bigimage", "name"], populate : {path : 'bigimage', select: "public_url"}});
      return res.status(200).json({ success: true, code: 200, message: '', installment: result });
    }
  } catch (error) {
    return next(error);
  }
};

// S??? l?????ng installment m???i ng??y, m???i th??ng, m???i qu??
const sessionInstallment = async (req, res, next) => {
	const today = new Date();
	try {
		let condition = {};
		if (req.query.browse != undefined && req.query.browse != '') {
			switch(req.query.browse){
				case 'day':
					condition.browse = {
						'$match': { 
							'_id.year' : today.getFullYear(), 
							'_id.month' : today.getMonth() + 1, 
							'_id.day': today.getDate()
						}
					}
					break;
				case 'month':
					condition.browse = { 
						'$match': { 
							'_id.year' : today.getFullYear(), 
							'_id.month' : today.getMonth() + 1 
						}
					}
					break;
				case 'year':
					condition.browse = {
						'$match': { 
							'_id.year' : today.getFullYear()
						}
					}
					break;
				default:
					condition.browse = {
						'$project': { 
							'_id' : 1, 'count': 1
						}
					};
			}
		}
		else{
			condition.browse = {
				'$project': { 
					'_id' : 1, 'count': 1
				}
			};
		}
		const pipeline = [
      {
        '$match': {
          'status': 1
        }
      },
			{
				'$group':
				{
					'_id':  {						
						day: {'$dayOfMonth': '$updatedAt'}, 
						month: {'$month': '$updatedAt'}, 
						year: {'$year': '$updatedAt'}
					},
					'count': {
						'$sum': 1
					}
				}
			},
			{ '$sort': { '_id.year': 1, '_id.month': 1, '_id.day': 1} },
			condition.browse
		];
		const installment = await Installment.aggregate(pipeline);
		const count = installment.reduce((accumulator, currentValue) => accumulator + currentValue.count, 0);
		return res
			.status(200)
			.json({ success: true, code: 200, message: '', count, installment});
	} catch (error) {
		return next(error);
	}
};

module.exports = {
	getAllInstallment,
	addInstallment,
	updateInstallment,
	deleteInstallment,
	getDetailInstallment,
  sessionInstallment
};
