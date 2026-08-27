# Context

> **Status 2026-08-27: this refinement session is complete.** Outcomes are written into
> `PLAN-ev-model.md` ("Decisions settled", "Deferred, not excluded", the next-wave list) and into
> `EV-1` §9, `EV-2` §7, `EV-3` §7–8, `EV-5` §1.11, §2.1, §2.2, §2.4, §2.10, §2.12. Terminology
> settled: **EV model** for the swappable weight unit (`statistical`, `houou`, future `ippan`).
> This file is kept as the session's input record.
>
> **Enrichment pass, same date:** new shortcomings `EV-5` §1.12 (bot-population priors), §2.13
> (backtest validation session); new seams `EV-1` §9 (weighted unseen pool), `EV-2` §7 (Bayes
> likelihood over the river); build-order change `EV-3` §5 (`BetaoirCost.csv` is the measured v1
> fold price); dama branch `EV-3` §6; memo third option `EV-5` §2.7; extraction-script build
> artifacts in PLAN; candidate-union cheap path `EV-5` §1.9; bounded widening `EV-1` §6.
>
> **Enrichment pass 2, same date:** neural ban refined (PLAN "Out of scope" — black-box EV models
> admissible behind the shared interface, never as an explanation; the houou placement MLP
> recorded as a candidate in `EV-3` §8); dama reading endorsed as a later wave (`EV-5` §1.4);
> joint threat enumeration cheap for ≤2 threats, planned (`EV-2` §5); EV models double as bots
> (`EV-5` §1.12); kyuushu decided at the push/fold layer under both models (`EV-3` §7).

This folder contains the output of the first round of requirement analysis with Opus 5 max.
At the moment, nothing is implemented and nothing has to be implemented, because we need further refinement.

PLAN-ev-model.md is the master plan file, EV-*.md files are deliverable based on the context of the first session.

`Context` section in the PLAN is correct, but take everything after it with a pinch of salt. That is not the definitive plan, this is a refineiment session to refine this plan and the deliverable by deep diving documents already produced and the points below.

I expect from you questions and a dynamic session to improve the plan, do not just autopilot, involve me.

# Table status (point, placements, turn) is NOT deferred
Table status can't be deferred, because the main goal of the efficiency is to get the best score possible (o best placement, depends on the declintation, see also below on this)

## So... how do we include it, is it only in the pull/push algorithm?
I see two possible ways, and I think I lean for the second solution, but you need to be critical on this:

1. table status is part of all three algorithm: here are practical examples on why it could make sense
  * for EV efficiency
    * East 3, you are third placemenet, starting hand with 9 different terminal, most logical think => kyuushu kyuuhai (not implemented yet, not the point, is an example)
    * South 4, you are in 4th place with 100 point, starting hand with 9 different terminal => (opinionable, but you get the point) go for kokushi
  * for EV folding: if you assume other players are efficient, they will play by the same rule aforementioned on efficiency => efficiency is a function of table status => defense is a function of table status
  * push/folding: I don't think it needs explanation

2. efficiency and defense algorithm are not function of table status, but they return the EV with potential value and risk information on possible moves, it will be the push/fold algorithm to evaluate which move is actually the best by looking table status. Getting again on the kyuushu kyuuhai/kokushi example, efficiency algorithm in this case will always return the same rates on that hand, push/fold algorithm will analyze the scoring provided by the efficiency algorithm and call kyuushu kyuuhai in first case and push in the second (again is an example, not a requirement or a statement)

## Data source for weight
In previous session, claude discovered the houou-statistics repo. I said to him that we want weights both from this datasource and from pure combinatorics statistic. This because I want the weigths to be swappable in scoring (and therefore in algorithm). The idea is:
* the future "EV algorithm" (here I am referring the "AI that plays the table, as the efficiency, defense and tsumogiri algorithms") should take as parameter which EV weigths take as input (houhou player, pure statisitcal combinatorics model)
* the future lab should show both scoring information
* eventually we might also add new weight sets: it might be intresting for the 2 previous points having also a statistical model of the "average 一般 room player"
* the point is that models should be modular

