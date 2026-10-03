export function defaultQwenConfig() {
  return {id:'qwen-default',name:'千问',provider:'Qwen',baseUrl:'https://dashscope.aliyuncs.com/compatible-mode/v1',model:'qwen-vl-max',apiKeyEncrypted:'',enabled:true,createdAt:new Date().toISOString()};
}
export function requireModelKey(config) {
  if(!config?.apiKeyEncrypted)throw new Error('尚未配置 API Key，请在 AI 设置中填写千问密钥后再生成');
}
