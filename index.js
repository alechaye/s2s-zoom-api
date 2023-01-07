require("dotenv").config();

const express = require("express");
const cors = require("cors");
const axios = require("axios");
const qs = require("query-string");
const { ZOOM_OAUTH_ENDPOINT, ZOOM_API_BASE_URL } = require("./utils/constants");

const app = express();
const port = process.env.PORT || 5000;

const redis = require("redis");

let redisClient;

const redisClientStart = async () => {
  redisClient = redis.createClient();

  redisClient.on("error", (error) => console.error(`Error : ${error}`));

  await redisClient.connect();
};

redisClientStart();

// Add Global Middlewares
app.use([cors(), express.json(), express.urlencoded({ extended: false })]);

app.options("*", cors());

// Token handling

const getTokenFromZoomAsync = async () => {
  try {
    // const { ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET } = process.env;
    const ZOOM_ACCOUNT_ID = "RdxUE0weQSCMrpgais2pRA";
    const ZOOM_CLIENT_ID = "MxjxbjiQC9wQjQ8YWiLw";
    const ZOOM_CLIENT_SECRET = "fOrt1MfapdLVIM5Q8bprGyA4p7ym04Qt";

    const request = await axios.post(
      ZOOM_OAUTH_ENDPOINT,
      qs.stringify({
        grant_type: "account_credentials",
        account_id: ZOOM_ACCOUNT_ID,
      }),
      {
        headers: {
          Authorization: `Basic ${Buffer.from(
            `${ZOOM_CLIENT_ID}:${ZOOM_CLIENT_SECRET}`
          ).toString("base64")}`,
        },
      }
    );

    const { access_token, expires_in } = await request.data;

    return { access_token, expires_in, error: null };
  } catch (error) {
    return { access_token: null, expires_in: null, error };
  }
};

const setTokenAsync = async ({ access_token, expires_in }) => {
  try {
    await redisClient.set("access_token", access_token);
    await redisClient.expire("access_token", expires_in);
  } catch (error) {
    console.error(error);
  }
};

/**
 * Middleware that checks if a valid (not expired) token exists in redis
 * If invalid or expired, generate a new token, set in redis, and append to http request
 */
const tokenCheckMiddleware = async (req, res, next) => {
  const redis_token = await redisClient.get("access_token");

  let token = redis_token;

  /**
   * Redis returns:
   * -2 if the key does not exist
   * -1 if the key exists but has no associated expire
   */
  if (!redis_token || ["-1", "-2"].includes(redis_token)) {
    const { access_token, expires_in, error } = await getTokenFromZoomAsync();

    if (error) {
      const { response, message } = error;
      return res
        .status(response?.status || 401)
        .json({ message: `Authentication Unsuccessful: ${message}` });
    }

    setTokenAsync({ access_token, expires_in });

    token = access_token;
  }

  req.headerConfig = {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  };
  return next();
};

/**
 * UPCOMING MEETINGS GET REQUEST
 */

async function cacheDataMeetingsMiddleware(req, res, next) {
  let results;
  try {
    const cacheResults = await redisClient.get("upcoming");
    if (cacheResults) {
      results = JSON.parse(cacheResults);
      res.send({
        fromCache: true,
        data: results,
      });
    } else {
      next();
    }
  } catch (error) {
    console.error(error);
    res.status(404).send("cacheDataMeetingsMiddleware failed");
  }
}

const getMeetingsFromZoomAsync = async (req, res) => {
  const { headerConfig } = req;

  try {
    const request = await axios.get(
      `${ZOOM_API_BASE_URL}/users/me/meetings?type=upcoming`,
      headerConfig
    );
    const data = request.data;
    await redisClient.set("upcoming", JSON.stringify(data), {
      // 60 seconds expiration
      EX: 60,
      NX: true,
    });
    res.send({
      fromCache: false,
      data: data,
    });
  } catch (err) {
    console.error(err);
    res.status(404).send("getMeetingsFromZoomAsync failed");
  }
};

app.get(
  "/upcoming-meetings",
  tokenCheckMiddleware,
  cacheDataMeetingsMiddleware,
  getMeetingsFromZoomAsync
);

/**
 * REGISTER TO A MEETING POST REQUEST
 */

const postRegisterToZoomMeetingAsync = async (req, res) => {
  const { headerConfig, params, body } = req;
  const { meetingId } = params;

  try {
    const request = await axios.post(
      `${ZOOM_API_BASE_URL}/meetings/${meetingId}/registrants`,
      body,
      headerConfig
    );
    return res.json(request.data);
  } catch (err) {
    console.error(err);
    res.status(404).send(`postRegisterToZoomMeetingAsync ${err}`);
  }
};

app.post(
  "/api/meetings/:meetingId/registrants",
  tokenCheckMiddleware,
  postRegisterToZoomMeetingAsync
);

app.listen(port, () => {
  console.log(`App listening on port ${port}`);
});
