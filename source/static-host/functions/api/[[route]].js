import {forward} from '../../shared/proxy.mjs';
export const onRequest=context=>forward(context);
