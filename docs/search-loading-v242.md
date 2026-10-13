# Search loading v242

Search browse no longer interprets an updated interest signature as an instruction to replace a painted grid. Navigation reuses the existing browse session or request. Clearing a typed search restores its saved browse inventory; future pagination can use updated interests while retaining existing tiles. Only an explicit refresh or category/account change replaces browse inventory.

Completed browse lanes now paint independently. Slow retailer requests cannot hold up the first products. Later lanes append with generation, account and section ownership guards. The two-per-family cap spans the whole request batch. Typing cancels browse work immediately, before the debounce fires. Stale batches cannot unlock another batch's loading flag.

The first nine product photos load eagerly, with high priority for the first three. Remaining images stay lazy and retain alternative-image retries. Persisted Search cache is partitioned by shopping region and expires after 30 minutes.

Validation: search-home-stability-check covers delayed lanes, retained DOM nodes after focus/navigation/taste updates, first-image priority, query/pagination races and short pages. Search intent, responsive Home, image fallbacks and listing gesture checks also run.
