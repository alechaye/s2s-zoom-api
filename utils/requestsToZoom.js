const express = require("express");
const axios = require("axios");
const { ZOOM_API_BASE_URL } = require("./constants");

const router = express.Router();

router.get("/meetings?type=upcoming", async (req, res) => {
  const { headerConfig } = req;

  try {
    const request = await axios.get(
      `${ZOOM_API_BASE_URL}/users/me/meetings?type=upcoming`,
      headerConfig
    );
    return res.json(request.data);
  } catch (err) {
    console.error(err);
  }
});

module.exports = router;
