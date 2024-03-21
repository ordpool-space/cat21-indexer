import * as Joi from 'joi';


export const configuration = () => {
  return {
    environment: process.env.NODE_ENV,
    port: process.env.PORT,
    esploraBaseUrl: process.env.ESPLORA_BASE_URL,
    ordBaseUrl: process.env.ORD_BASE_URL,
    ordBaseUrlTestnet: process.env.ORD_BASE_URL_TESTNET,
    dbOptions: {
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      username: process.env.DB_USERNAME,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
    }
  }
}

export const validationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production'),
  PORT: Joi.number(),
  ESPLORA_BASE_URL: Joi.string(),
  ORD_BASE_URL: Joi.string().required(),
  ORD_BASE_URL_TESTNET: Joi.string().required(),
  DB_HOST: Joi.string(),
  DB_PORT: Joi.number(),
  DB_USERNAME: Joi.string(),
  DB_PASSWORD: Joi.string(),
  DB_NAME: Joi.string()
})
