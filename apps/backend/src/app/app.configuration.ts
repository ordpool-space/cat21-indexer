import * as Joi from 'joi';


export const configuration = () => {
  return {
    environment: process.env.NODE_ENV,
    port: process.env.PORT,
    esploraBaseUrl: process.env.ESPLORA_BASE_URL,
    ordBaseUrl: process.env.ORD_BASE_URL,
    ordBaseUrlTestnet: process.env.ORD_BASE_URL_TESTNET
  }
}

export const validationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production'),
  PORT: Joi.number(),
  ESPLORA_BASE_URL: Joi.string(),
  ORD_BASE_URL: Joi.string().required(),
  ORD_BASE_URL_TESTNET: Joi.string()
})
