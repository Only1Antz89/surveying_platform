export function validLocationUpdate(observedAt:Date,createdAt:Date,expiresAt:Date,stoppedAt:Date|null,now=new Date()){return !stoppedAt&&expiresAt>now&&observedAt>=createdAt&&observedAt<=now&&now.getTime()-observedAt.getTime()<=120000;}
export function trackingFresh(observedAt:Date,now=new Date()){return now.getTime()-observedAt.getTime()<=120000;}
export function trackingEnd(now:Date,workdayEnd:Date){return new Date(Math.min(now.getTime()+12*3600000,workdayEnd.getTime()));}
