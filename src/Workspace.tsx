import { useState } from "react";
import NormalChart from "./App.test.v6";
import Trainer from "./Trainer";
import KiEntries from "./KiEntries";
import FlipKi from "./FlipKi";

type View="chart"|"trainer"|"ki"|"flip";
export default function Workspace(){
 const [view,setView]=useState<View>(()=>(sessionStorage.getItem("qtrend_view") as View)||"chart");
 function open(next:View){setView(next);sessionStorage.setItem("qtrend_view",next)}
 return <div className="qtrend-workspace"><nav className="qtrend-window-tabs"><button className={view==="chart"?"active":""} onClick={()=>open("chart")}>CHART</button><button className={view==="trainer"?"active":""} onClick={()=>open("trainer")}>TRAINER</button><button className={view==="ki"?"active":""} onClick={()=>open("ki")}>KI-ENTRYS</button><button className={view==="flip"?"active":""} onClick={()=>open("flip")}>FLIP-KI</button></nav><div className="qtrend-window-body">{view==="chart"?<NormalChart/>:view==="trainer"?<Trainer/>:view==="ki"?<KiEntries/>:<FlipKi/>}</div></div>
}
