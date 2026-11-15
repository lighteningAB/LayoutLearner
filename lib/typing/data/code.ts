// Code-ish tokens (no spaces inside a token). Language-neutral with a JS/TS/Python/C lean.
const RAW = `
const let var function return if else for while do switch case break continue default new delete typeof instanceof
import export from async await try catch finally throw class extends super this null undefined true false void
static public private protected interface type enum implements readonly abstract yield in of def elif lambda pass
None True False self print len range int str float bool list dict set tuple struct fn impl pub mut use mod match
=> === !== == != <= >= && || ++ -- += -= *= /= ?. ?? ... :: -> <- {} [] () <> // /* */ #include #define
i++ i-- x++ n-1 n+1 i=0 i<n x=y a[i] b[j] arr[0] obj.key foo() bar() main() init() get() set() map() filter() reduce()
push() pop() shift() slice() split() join() length index value key item node next prev head tail left right root
count total result error data args props state ctx req res err cb fn tmp buf ptr len max min sum avg idx
console.log(x); return; break; x=1; y=2; i+=1; n*=2; a&&b a||b !done x?y:z (a,b) [i] {x} <T> "str" 'c' \`tpl\`
array string number boolean object symbol bigint any never unknown Promise Map Set Date Math JSON Object Array
parse stringify then resolve reject fetch require module exports process env argv stdin stdout stderr exit
git commit push pull merge branch rebase diff log status add clone npm yarn node deno cargo make grep sed awk
`;

export const CODE_TOKENS: string[] = Array.from(new Set(RAW.split(/\s+/).filter(Boolean)));
