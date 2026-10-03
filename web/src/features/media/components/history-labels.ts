/** Calendar-day labels use local dates, so midnight and DST don't shift yesterday. */
export function historyDay(timestamp:number|undefined,now=new Date()):string {
  if(timestamp===undefined||!Number.isFinite(timestamp))return '更早';
  const date=new Date(timestamp);if(!Number.isFinite(date.getTime()))return '更早';
  const key=(value:Date)=>`${value.getFullYear()}-${value.getMonth()}-${value.getDate()}`;
  if(key(date)===key(now))return '今天';
  const yesterday=new Date(now);yesterday.setDate(yesterday.getDate()-1);
  if(key(date)===key(yesterday))return '昨天';
  return `${date.getFullYear()}年${date.getMonth()+1}月${date.getDate()}日`;
}

export function historyPosition(position:number,start:number):string {
  const seconds=Number.isFinite(position)&&Number.isFinite(start)?Math.max(0,Math.floor(position-start)):0;
  const minutes=Math.floor(seconds/60),rest=String(seconds%60).padStart(2,'0');
  return minutes>=60?`${Math.floor(minutes/60)}:${String(minutes%60).padStart(2,'0')}:${rest}`:`${String(minutes).padStart(2,'0')}:${rest}`;
}
