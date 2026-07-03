// 脚本参考: [chxm1023](https://t.me/chxm1023)


const responseData = {};
const headers = $request.headers;
const parsedResponse = JSON.parse(typeof $response != "undefined" && $response.body || null);
const userAgent = headers['User-Agent'] || headers['user-agent'];

if (typeof $response == "undefined") {
  delete headers["x-revenuecat-etag"];
  delete headers["X-RevenueCat-ETag"];
  responseData.headers = headers;
} else if (parsedResponse && parsedResponse.subscriber) {
  parsedResponse.subscriber.subscriptions = parsedResponse.subscriber.subscriptions || {};
  parsedResponse.subscriber.entitlements = parsedResponse.subscriber.entitlements || {};
  
  if (new RegExp(`^MOZE`, `i`).test(userAgent)) {
    const data = {  "purchase_date" : "2023-09-09T09:09:09Z",  "expires_date" : "2099-09-09T09:09:09Z" };
    const name = 'MOZE_PREMIUM_SUBSCRIPTION';
    const ids = 'MOZE_PRO_SUBSCRIPTION_YEARLY_BASIC';
    
    parsedResponse.subscriber.entitlements[name] = Object.assign({}, data, { product_identifier: ids });
    
    const subData = Object.assign({}, data, {
      "original_purchase_date": "2023-09-09T09:09:09Z",
      "store": "app_store",
      "ownership_type": "PURCHASED"
    });
    parsedResponse.subscriber.subscriptions[ids] = subData;
    
    responseData.body = JSON.stringify(parsedResponse);
    console.log('MOZE解锁成功');
  }
}

$done(responseData);