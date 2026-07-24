export const QTREND_TIME_ZONE = "Europe/Berlin";

export function formatBerlinDateTime(value?: string | number | Date | null): string {
  if (value === undefined || value === null || value === "") return "–";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("de-DE", {
    timeZone: QTREND_TIME_ZONE,
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).format(date);
}

export function berlinInputNow(hour = 22): string {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: QTREND_TIME_ZONE, year:"numeric", month:"2-digit", day:"2-digit",
    hour:"2-digit", minute:"2-digit", hour12:false,
  }).formatToParts(now).reduce<Record<string,string>>((a,p)=>(a[p.type]=p.value,a),{});
  const d = new Date(`${parts.year}-${parts.month}-${parts.day}T${String(hour).padStart(2,"0")}:00:00`);
  if (hour <= Number(parts.hour)) d.setDate(d.getDate()+1);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}T${String(hour).padStart(2,"0")}:00`;
}

export function berlinInputCurrent(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: QTREND_TIME_ZONE, year:"numeric", month:"2-digit", day:"2-digit",
    hour:"2-digit", minute:"2-digit", hour12:false,
  }).formatToParts(new Date()).reduce<Record<string,string>>((a,p)=>(a[p.type]=p.value,a),{});
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function berlinLocalInputToIso(value: string): string {
  // Europe/Berlin offset is derived by Intl, including DST.
  const [datePart,timePart="00:00"] = value.split("T");
  const [y,m,d] = datePart.split("-").map(Number); const [hh,mm] = timePart.split(":").map(Number);
  let guess = Date.UTC(y,m-1,d,hh,mm,0);
  const getParts=(ms:number)=>Object.fromEntries(new Intl.DateTimeFormat("en-CA",{timeZone:QTREND_TIME_ZONE,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false}).formatToParts(new Date(ms)).map(p=>[p.type,p.value]));
  for(let i=0;i<3;i++){const p=getParts(guess);const localAsUtc=Date.UTC(Number(p.year),Number(p.month)-1,Number(p.day),Number(p.hour),Number(p.minute));guess-=localAsUtc-Date.UTC(y,m-1,d,hh,mm);}
  const offsetParts=getParts(guess); const localAsUtc=Date.UTC(Number(offsetParts.year),Number(offsetParts.month)-1,Number(offsetParts.day),Number(offsetParts.hour),Number(offsetParts.minute));
  const offsetMin=Math.round((localAsUtc-guess)/60000); const sign=offsetMin>=0?"+":"-"; const abs=Math.abs(offsetMin);
  return `${datePart}T${timePart}:00${sign}${String(Math.floor(abs/60)).padStart(2,"0")}:${String(abs%60).padStart(2,"0")}`;
}

export function chartBerlinTime(time: number): string {
  return new Intl.DateTimeFormat("de-DE", {timeZone:QTREND_TIME_ZONE,day:"2-digit",month:"2-digit",year:"2-digit",hour:"2-digit",minute:"2-digit"}).format(new Date(Number(time)*1000));
}
