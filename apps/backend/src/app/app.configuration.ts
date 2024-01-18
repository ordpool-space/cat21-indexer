import * as Joi from 'joi';


export const configuration = () => {

  const network = process.env.NETWORK;

  return {
    environment: process.env.NODE_ENV,
    port: process.env.PORT
  }
}

export const validationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production'),
  PORT: Joi.number()
})
