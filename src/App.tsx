import { useEffect, useState } from "react";
import Cockpit from "./App.test.v6";
import "./App.css";
import Trainer from "./Trainer";

export default function App(){
  const [trainer,setTrainer]=useState(()=>new URLSearchParams(window.location.search).get("view")==="trainer");
  useEffect(()=>{const f=()=>setTrainer(new URLSearchParams(window.location.search).get("view")==="trainer");window.addEventListener("popstate",f);return()=>window.removeEventListener("popstate",f)},[]);
  if(trainer)return <Trainer/>;
  return <><Cockpit/><a className="trainer-fab" href="/?view=trainer">TRAINER</a></>;
}
