const integer = (minimum: number, maximum: number) => ({ type: 'integer', minimum, maximum });
const text = { type: 'string', minLength: 1, maxLength: 128 };
const definitions: any[] = [
    ['runtime_trace_node', 'Observe native node changes for a bounded window; optionally capture synchronous emitter stacks. No events is not proof of no changes.', { uuid:text, durationMs:integer(50,1500), maxEvents:integer(1,64), includeStack:{type:'boolean'} }, ['uuid']],
    ['runtime_hit_candidates', 'List overlapping geometric candidates at viewport CSS client coordinates. Candidates are not proven input receivers; masks and propagation require separate evidence.', { x:{type:'number'}, y:{type:'number'}, limit:integer(1,32) }, ['x','y']],
    ['runtime_render_summary', 'Capture a short bounded summary of existing render batch-break diagnostics, restoring hooks afterwards. Reasons are evidence, not proof of a texture cause.', { durationMs:integer(50,1000), limit:integer(1,64) }, []],
    ['runtime_environment', 'Read whitelisted engine, device, resolution, physics and atlas settings.', {}, []],
    ['runtime_storage', 'Read local storage metadata by default, or values only for explicitly requested keys. Sensitive keys/values are redacted; reads are bounded; never writes.', { keys:{type:'array',items:text,minItems:1,maxItems:8,uniqueItems:true}, prefix:{type:'string',maxLength:128}, limit:integer(1,64) }, []],
];
export const DIAGNOSTIC_TOOLS = definitions.map(([name,description,properties,required]) => ({name,description,
    inputSchema:{type:'object',properties,required,additionalProperties:false}, annotations:{readOnlyHint:true,destructiveHint:false}}));
export function validDiagnosticArgs(name: string, args: any): boolean {
    const tool = DIAGNOSTIC_TOOLS.find(t=>t.name===name);
    if (!tool || !args || typeof args !== 'object' || Array.isArray(args)) return false;
    const schema = tool.inputSchema;
    if (schema.required.some((k:string)=>!Object.prototype.hasOwnProperty.call(args,k))) return false;
    return Object.keys(args).every(k=>{
        const spec=schema.properties[k],v=args[k]; if(!spec) return false;
        if(spec.type==='integer') return Number.isInteger(v)&&v>=spec.minimum&&v<=spec.maximum;
        if(spec.type==='number') return typeof v==='number'&&Number.isFinite(v);
        if(spec.type==='boolean') return typeof v==='boolean';
        if(spec.type==='string') return typeof v==='string'&&v.length>=(spec.minLength||0)&&v.length<=spec.maxLength;
        return Array.isArray(v)&&v.length>=1&&v.length<=8&&new Set(v).size===v.length&&v.every(s=>typeof s==='string'&&s.length>=1&&s.length<=128);
    });
}
