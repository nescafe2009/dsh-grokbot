export function decodeToolArguments(value){
 for(let i=0;i<3&&typeof value==='string';i++){try{value=JSON.parse(value)}catch{return null}}
 return value&&typeof value==='object'&&!Array.isArray(value)?value:null
}
