/*
 * Copyright (c) 2014-2026 Bjoern Kimminich & the OWASP Juice Shop contributors.
 * SPDX-License-Identifier: MIT
 */

import { type Request, type Response, type NextFunction } from 'express'

import * as challengeUtils from '../lib/challengeUtils'
import { challenges } from '../data/datacache'
import * as security from '../lib/insecurity'
import { type Review } from '../data/types'
import * as db from '../data/mongodb'
import logger from '../lib/logger'

// Estimated average request time in milliseconds 
let emaMs = 50
const alpha = 0.1

const updateEma = function(ms: number) {
  emaMs = alpha * ms + (1 - alpha) * emaMs
}

const clamp = function(x: number, min: number, max: number) {
  return Math.max(min, Math.min(max, x))
}

const randInt = function(lo: number, hi: number) {
  return Math.floor(lo + Math.random() * (hi - lo + 1))
}

function computeDelayMs() {
  const base = randInt(20, 25) //clamp(Math.round(0.6 * emaMs), 4, 50)
  const jitter = randInt(2, 12)
  return base + jitter
}

const sleep = async (ms: number) => await new Promise(resolve => setTimeout(resolve, ms))

export function likeProductReviews () {
  return async (req: Request, res: Response, next: NextFunction) => {

    const t0 = process.hrtime.bigint()
    let injectedDelay = 0

    const id = req.body.id
    const user = security.authenticatedUsers.from(req)
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    try {
      const review = await db.reviewsCollection.findOne({ _id: id })

      if (!review) {
        return res.status(404).json({ error: 'Not found' })
      }

      const likedBy = review.likedBy
      if (likedBy.includes(user.data.email)) {
        return res.status(403).json({ error: 'Not allowed' })
      }


      await db.reviewsCollection.update(
        { _id: id },
        { $inc: { likesCount: 1 } }
      )

      // Artificial wait for timing attack challenge
      // await sleep(150)

      // Stretch the actual race window
      injectedDelay = computeDelayMs()

      console.log("[*] Artificial delay: " + injectedDelay)

      await sleep(injectedDelay)

      try {
        const updatedReview: Review = await db.reviewsCollection.findOne({ _id: id })
        const updatedLikedBy = updatedReview.likedBy
        updatedLikedBy.push(user.data.email)

        const count = updatedLikedBy.filter(email => email === user.data.email).length

        challengeUtils.solveIf(challenges.timingAttackChallenge, () => count > 2)

        const result = await db.reviewsCollection.update(
          { _id: id },
          { $set: { likedBy: updatedLikedBy } }
        )
        res.json(result)
      } catch (err) {
        res.status(500).json(err)
      }
    } catch (err) {
      res.status(400).json({ error: 'Wrong Params' })
    } finally {
      // const t1 = process.hrtime.bigint()

      // const totalMs = Number(t1 - t0) / 1e6
      // console.log("[*] total response time in ms: " + totalMs)
      
      // // Track baseline without your injected sleep
      // const baselineMs = Math.max(0, totalMs - injectedDelay)
      // updateEma(baselineMs)
    }
  }
}
