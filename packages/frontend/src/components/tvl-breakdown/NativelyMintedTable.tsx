import React from 'react'

import { TVLProjectBreakdown } from '../../pages/scaling/projects-tvl-breakdown/props/getTvlBreakdownView'
import { TVLBreakdownTableView } from './table/TVLBreakdownTableView'
import { TableSum } from './table/TableSum'
import { getNativelyMintedColumns } from './table/props/getTVLBreakdownTableColumns'

interface NativelyMintedTableProps {
  tokens: TVLProjectBreakdown['native']
}

export function NativelyMintedTable(props: NativelyMintedTableProps) {
  const sum = props.tokens.reduce((acc, token) => {
    return acc + Number(token.usdValue)
  }, 0)

  return (
    <div className="flex flex-col px-4 md:px-0">
      <h2 className="mb-3 ml-1 mt-12 text-xl font-bold md:mb-4 md:ml-2 md:text-2xl">
        Natively Minted Value
      </h2>
      <TVLBreakdownTableView
        columns={getNativelyMintedColumns()}
        items={props.tokens}
        type="NMV"
        empty={props.tokens.length === 0}
      />
      <TableSum amount={sum} />
    </div>
  )
}
