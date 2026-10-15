import crypto from 'node:crypto';
export function hashPin(pin:string){const salt=crypto.randomBytes(16).toString('hex');return `${salt}:${crypto.scryptSync(pin,salt,32).toString('hex')}`;}
export function verifyPin(pin:string,stored:string,legacy=false){
  if(legacy)return crypto.timingSafeEqual(crypto.createHash('sha256').update(pin).digest(),crypto.createHash('sha256').update(stored).digest());
  const [salt,hash]=stored.split(':');if(!salt || !hash)return false;const actual=crypto.scryptSync(pin,salt,32);const expected=Buffer.from(hash,'hex');return expected.length===actual.length && crypto.timingSafeEqual(actual,expected);
}
