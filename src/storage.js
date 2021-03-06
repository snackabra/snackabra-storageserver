/*
   Copyright (C) 2019-2021 Magnusson Institute, All Rights Reserved

   "Snackabra" is a registered trademark

   This program is free software: you can redistribute it and/or
   modify it under the terms of the GNU Affero General Public License
   as published by the Free Software Foundation, either version 3 of
   the License, or (at your option) any later version.

   This program is distributed in the hope that it will be useful, but
   WITHOUT ANY WARRANTY; without even the implied warranty of
   MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
   Affero General Public License for more details.

   You should have received a copy of the GNU Affero General Public
   License along with this program.  If not, see www.gnu.org/licenses/

*/


/**
 * The DEBUG flag will do two things that help during development:
 * 1. we will skip caching on the edge, which makes it easier to
 *    debug.
 * 2. we will return an error message on exception in your Response rather
 *    than the default 404.html page.
 */
const DEBUG = true
import * as utils from "./utils.js";

export default {
  async fetch(request, env, ctx) {
    try {
      return await handleRequest(request, env, ctx);
    } catch (e) {
      if (DEBUG) {
        return returnResult(request, JSON.stringify({ error: e.message }), 500);
      }
      return returnResult(request, JSON.stringify({ error: 'Internal service error' }), 500);
    }
  }
}

async function handleRequest(request, env) {  // not using ctx

  try {
    let options = {}
    if (DEBUG) {
      // customize caching
      options.cacheControl = {
        bypassCache: true,
      };
    }
    const { method, url } = request
    const { pathname } = new URL(url)
    if (method === "OPTIONS") {
      return handleOptions(request)
    } else if (pathname.split('/')[1] === 'api') {
      return await handleApiCall(request, env)
    } else if (pathname === '/.well-known/apple-app-site-association') {
      return universalLinkFile(request);
    } else {
      return returnResult(request, JSON.stringify({ error: pathname + ' Not found' }), 404);
    }

  } catch (e) {
    // if an error is thrown try to serve the asset at 404.html
    if (!DEBUG) {
      return returnResult(request, JSON.stringify({ error: 'Not found' }), 404);
    }

    return returnResult(request, JSON.stringify({ error: e.message }), 404);
  }
}

function returnResult(request, contents, s) {
  const corsHeaders = {
    "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
    "Access-Control-Allow-Headers": "Content-Type, authorization",
    'Content-Type': 'application/json;',
    "Access-Control-Allow-Origin": request.headers.get("Origin")
  }
  return new Response(contents, { status: s, headers: corsHeaders });
}

function handleOptions(request) {
  if (request.headers.get("Origin") !== null &&
    request.headers.get("Access-Control-Request-Method") !== null &&
    request.headers.get("Access-Control-Request-Headers") !== null) {
    return returnResult(request, null, 200)
  } else {
    // Handle standard OPTIONS request.
    return new Response(null, {
      headers: {
        "Allow": "POST, OPTIONS",
      }
    })
  }
}

async function handleApiCall(request, env) {
  const { pathname } = new URL(request.url);
  const fname = pathname.split('/')[3];
  try {
    switch (fname) {
      case 'storeRequest':
        return await handleStoreRequest(request, env)
      case 'storeData':
        return await handleStoreData(request, env)
      case 'fetchData':
        return await handleFetchData(request, "p", env)
      case 'migrateStorage':
        return await handleMigrateStorage(request, env)
      case 'fetchDataMigration':
        return await handleFetchDataMigration(request, env)
      case 'robots.txt':
        // TODO ... if there's something better to return, otherwise error
        return returnResult(request, "Disallow: /", 500);
      default:
        return handleDevelopmentMode();
    }
  } catch (error) {
    console.log(error)
    return returnResult(request, JSON.stringify({ error: error }), 500);
  }
}

function handleDevelopmentMode() {
  const html = `<!doctypehtml> <html> <body> <div style="display: block; font-weight: bold; padding: 5%; margin: auto; font-family: countach,sans-serif; line-height: 1; margin: 0;"> <h1 style="text-align: center;"> This feature is currently under development. Stay tuned! </h3> </div> </body> </html>`
  return new Response(html, {
    headers: {
      "content-type": "text/html;charset=UTF-8",
    },
  })
}

async function handleStoreRequest(request, env) {
  try {
    const { searchParams } = new URL(request.url);
    const name = searchParams.get('name');
    const list_resp = await env.IMAGES_NAMESPACE.list({ 'prefix': name });
    let data = {};
    if (list_resp.keys.length > 0) {
      const key = list_resp.keys[0].name;
      const val = await env.IMAGES_NAMESPACE.get(key, { type: "arrayBuffer" });
      data = utils.extractPayload(val);
    }
    const salt = Object.prototype.hasOwnProperty.call(data, 'salt') ? data.salt : crypto.getRandomValues(new Uint8Array(16));
    const iv = Object.prototype.hasOwnProperty.call(data, 'iv') ? data.iv : crypto.getRandomValues(new Uint8Array(12));
    // subtle not doing this:
    // const salt = data.hasOwnProperty('salt') ? data.salt : crypto.getRandomValues(new Uint8Array(16));
    // const iv = data.hasOwnProperty('iv') ? data.iv : crypto.getRandomValues(new Uint8Array(12));

    const return_data = { iv: iv, salt: salt };
    const payload = utils.assemblePayload(return_data);
    const corsHeaders = {
      "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Origin": request.headers.get("Origin")
    }
    return new Response(payload, { status: 200, headers: corsHeaders });

  } catch (error) {
    console.log(error);
    return returnResult(request, JSON.stringify({ error: error }), 500)
  }
}

async function handleStoreData(request, env) {
  try {
    const { searchParams } = new URL(request.url);
    const image_id = searchParams.get('key');
    // console.log(image_id)
    const type = searchParams.get('type');
    const key = "____" + type + "__" + image_id + "______";
    // console.log(key, await IMAGES_NAMESPACE.get(key))
    const val = await request.arrayBuffer();
    const data = utils.extractPayload(val);
    console.log("EXTRACTED DATA IN MAIN: ", Object.keys(data))
    // const storageToken = data.storageToken;
    let verification_token;

    const _storage_token = JSON.parse((new TextDecoder).decode(data.storageToken));
    let _ledger_resp = JSON.parse(await env.LEDGER_NAMESPACE.get(_storage_token.token_hash)) || {};
    console.log(_ledger_resp, _storage_token)
    /*
    if (!verifyStorage(data, image_id, env, _ledger_resp)) {
      return returnResult(request, JSON.stringify({ error: 'Ledger(s) refused storage request - authentication or storage budget issue, or malformed request' }), 500);
    }

     */

    const stored_data = await env.IMAGES_NAMESPACE.get(key, { type: "arrayBuffer" });
    if (stored_data == null) {
      verification_token = crypto.getRandomValues(new Uint16Array(4)).buffer;
      data['verification_token'] = verification_token;
      await env.IMAGES_NAMESPACE.put(key, utils.assemblePayload(data));
      //console.log("Generated and stored verification token", store_resp);
    } else {
      const data = utils.extractPayload(stored_data);
      // console.log('Data', data);
      verification_token = data.verification_token;
    }
    console.log("Extracted data: ", data)

    _ledger_resp.used = true;
    let _put_resp = await env.LEDGER_NAMESPACE.put(_storage_token.token_hash, JSON.stringify(_ledger_resp));
    env.RECOVERY_NAMESPACE.put(_storage_token.hashed_room_id + '_' + _storage_token.encrypted_token_id, 'true');
    env.RECOVERY_NAMESPACE.put(_storage_token.token_hash + '_' + image_id, 'true');
    env.RECOVERY_NAMESPACE.put(image_id + '_' + _storage_token.token_hash, 'true');
    // await fetch('https://s_socket.privacy.app/api/token/' + new TextDecoder().decode(storageToken) + '/useToken');
    return returnResult(request, JSON.stringify({
      image_id: image_id,
      size: val.byteLength,
      verification_token: new Uint16Array(verification_token).join(''),
      ledger_resp: _put_resp
    }), 200);
  } catch (error) {
    console.log("Error posting image: ", error);
    return returnResult(request, JSON.stringify({ error: error.toString() }), 500)
  }
}

async function handleFetchData(request, type, env) {
  try {
    const { searchParams } = new URL(request.url);
    const verification_token = searchParams.get('verification_token');
    // const storage_token = searchParams.get('storage_token');
    const id = searchParams.get('id');
    const key = "____" + type + "__" + id + "______";
    const stored_data = await env.IMAGES_NAMESPACE.get(key, { type: "arrayBuffer" });
    console.log("Stored data", stored_data)
    const data = utils.extractPayload(stored_data);
    // const storage_resp = await (await fetch('https://s_socket.privacy.app/api/token/' + storage_token + '/checkUsage')).json();
    if (verification_token !== new Uint16Array(data.verification_token).join('')) {
      return returnResult(request, JSON.stringify({ error: 'Verification failed' }), 200);
    }
    const corsHeaders = {
      "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Origin": request.headers.get("Origin")
    }
    return new Response(utils.assemblePayload(data), { status: 200, headers: corsHeaders });
  } catch (error) {
    return returnResult(request, JSON.stringify({ error: error.toString() }), 500)
  }
}


async function verifyStorage(data, id, env, _ledger_resp) {
  const dataHash = await generateDataHash(data.image);
  if (id.slice(-dataHash.length) !== dataHash) {
    return false;
  }
  // older design ... we think ...
  // const ledger_data = JSON.parse((new TextDecoder()).decode(data.storageToken)) || {};
  // const token_hash = ledger_data.token_hash_buffer;
  if (!_ledger_resp || _ledger_resp.used || _ledger_resp.size !== data.image.byteLength) {
    return false;
  }
  return true;
}

async function generateDataHash(data) {
  try {
    const digest = await crypto.subtle.digest('SHA-256', data);
    return encodeURIComponent(utils.arrayBufferToBase64(digest));
  } catch (e) {
    console.log(e);
    return null;
  }
}

function universalLinkFile(request) {
  const corsHeaders = {
    "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Origin": request.headers.get("Origin")
  }
  let json = {
    "applinks": {
      "details": [
        {
          "appIDs": ["BFX746944J.app.snackabra"],
          "components": [
            {
              "/": "*",
              "comment": "Matches any URL"
            }
          ]
        }
      ]
    }
  }
  let file = new Blob([JSON.stringify(json)], { type: 'application/json' });
  return new Response(file, { status: 200, headers: corsHeaders });
}

async function handleMigrateStorage(request, env) {
  try {
    console.log("In handleMigrate");
    let data = await request.arrayBuffer();
    let jsonString = new TextDecoder().decode(data);
    let json = JSON.parse(jsonString);
    let targetURL = json['target'];
    console.log("TargetURL: ", targetURL)
    delete json['target'];
    if (!Object.prototype.hasOwnProperty.call(json, 'SERVER_SECRET') || !(json['SERVER_SECRET'] === env.SERVER_SECRET)) { // yes you just need one '!'
      return returnResult(request, JSON.stringify({ error: "Server verification failed" }), 500)
    }
    delete json['SERVER_SECRET']
    for (let key in json) {
      const key_parts = key.split(".");
      const key_id = key_parts[0];
      let type = key_parts[1];
      if (type !== "p" && type !== "f") {
        type = "p";
      }
      let reqUrl = "https://" + targetURL + "/api/v1/fetchDataMigration?id=" + encodeURIComponent(key_id) + "&verification_token=" + json[key] + "&type=" + type;
      let fetch_req = await fetch(reqUrl);
      if (fetch_req.status === 500 && type !== "f") {
        type = "f";
        reqUrl = "https://" + targetURL + "/api/v1/fetchDataMigration?id=" + encodeURIComponent(key_id) + "&verification_token=" + json[key] + "&type=" + type;
        fetch_req = await fetch(reqUrl);
      }
      let ab = await fetch_req.arrayBuffer();
      const kv_key = "____" + type + "__" + key_id + "______";
      env.IMAGES_NAMESPACE.put(kv_key, ab);
    }
    return returnResult(request, JSON.stringify({ success: true }), 200)
  } catch (error) {
    console.log(error)
    return returnResult(request, JSON.stringify({ error: error.message }), 500);
  }
}

async function handleFetchDataMigration(request, env) {
  try {
    const { searchParams } = new URL(request.url);
    const verification_token = searchParams.get('verification_token');
    // const storage_token = searchParams.get('storage_token');
    const id = searchParams.get('id');
    const type = searchParams.get('type')
    const key = "____" + type + "__" + id + "______";
    const stored_data = await env.IMAGES_NAMESPACE.get(key, { type: "arrayBuffer" });
    console.log("Stored data", stored_data)
    if (stored_data == null) {
      return returnResult(request, JSON.stringify({ error: "Could not find data" }), 500);
    }
    const data = utils.extractPayload(stored_data);
    // const storage_resp = await (await fetch('https://s_socket.privacy.app/api/token/' + storage_token + '/checkUsage')).json();
    if (verification_token !== new Uint16Array(data.verification_token).join('')) {
      return returnResult(request, JSON.stringify({ error: 'Verification failed' }), 200);
    }
    const corsHeaders = {
      "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Origin": request.headers.get("Origin")
    }
    return new Response(utils.assemblePayload(data), { status: 200, headers: corsHeaders });
  } catch (error) {
    return returnResult(request, JSON.stringify({ error: error.toString() }), 500)
  }
}
