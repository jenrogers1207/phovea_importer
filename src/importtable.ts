/**
 * Created by Samuel Gratzl on 29.09.2016.
 */

import {mixin, fixId, randomId, identity} from 'phovea_core/src/index';
import {retrieve} from 'phovea_core/src/session';
import * as d3 from 'd3';
import {ITypeDefinition, ValueTypeEditor, guessValueType, updateType, createTypeEditor} from './valuetypes';
import {IDataDescription} from 'phovea_core/src/datatype';

export interface IColumnDefinition {
  name: string;
  column: string|number;
  value: ITypeDefinition;
}

function commonFields(name: string) {
  const prefix = 'i' + randomId(3);
  return `
    <div class="form-group">
      <label for="${prefix}_name">Name</label>
      <input type="text" class="form-control" id="${prefix}_name" name="name" value="${name}" required="required">
    </div>
    <div class="form-group">
      <label for="${prefix}_desc">Description</label>
      <textarea class="form-control" id="${prefix}_desc" name="desc" rows="3"></textarea>
    </div>`;
}

function extractCommonFields($root: d3.Selection<any>) {
  return {
    name: $root.select('input[name="name"]').property('value'),
    description: $root.select('textarea[name="desc"]').property('value')
  };
}

export async function importTable(editors: ValueTypeEditor[], $root: d3.Selection<any>, header: string[], data: string[][], name: string) {
  $root.html(`${commonFields(name)}
      <table class="table table-striped table-condensed">
        <thead>
          <th>Column</th>
          <th>Type</th>
        </thead>
        <tbody></tbody>
      </table>
    `);

  const configPromises = header.map((name, i) => {
    return guessValueType(editors, name, i, data, (row) => row[i], i);
  });

  const guessedEditors = await Promise.all(configPromises);
  const config = await Promise.all(header.map(async (name, i) => ({
    column: i,
    name,
    editor: guessedEditors[i],
    value: await guessedEditors[i].guessOptions({type: null}, data, (col) => col[i])
  })));

  const $rows = $root.select('tbody').selectAll('tr').data(config);

  const $rowsEnter = $rows.enter().append('tr')
    .html((d) => `
      <td>
        <input type="input" class="form-control" value="${d.name}">
      </td>
      <td class="input-group">
          ${createTypeEditor(editors, d.editor, d.value)}
      </td>`);
  $rowsEnter.select('input').on('change', function (d) {
    d.name = this.value;
  });
  $rowsEnter.select('select').on('change', updateType(editors));
  $rowsEnter.select('button').on('click', (d) => {
    d.editor.edit(d.value);
  });
  const common = extractCommonFields($root);

  return () => ({data, desc: toTableDataDescription(config, data, common)});
}

function getCurrentUser() {
  return retrieve('username', 'Anonymous');
}

function toTableDataDescription(config: IColumnDefinition[], data: any[], common: {name: string, description: string}) {
  //derive all configs
  config = config.filter((c) => (<any>c).editor != null);
  config.forEach((d) => {
    const editor = (<any>d).editor;
    editor.parse(d.value, data, (row, value?) => {
      if (typeof value !== 'undefined') {
        return row[d.column] = value;
      }
      return row[d.column];
    });
  });

  //generate config
  let idProperty = config.filter((d) => d.value.type === 'idType')[0];
  if (!idProperty) {
    //create an artificial one
    idProperty = {value: {type: 'idType', idType: 'Custom'}, name: 'IDType', column: '_index'};
    data.forEach((d, i) => d._index = i);
  }
  const columns = config.filter((c) => c !== idProperty).map((c) => {
    const r: IColumnDefinition = mixin(<any>{}, c);
    delete (<any>r).editor;
    return r;
  });
  const desc: IDataDescription = {
    type: 'table',
    id: fixId(common.name + randomId(2)),
    name: common.name,
    description: common.description,
    creator: getCurrentUser(),
    ts: Date.now(),
    fqname: 'upload/' + common.name,
    size: [data.length, columns.length],
    idtype: (<any>idProperty).value.idType,
    columns,
    idcolumn: <string>idProperty.column
  };

  return desc;
}


export async function importMatrix(editors: ValueTypeEditor[], $root: d3.Selection<any>, header: string[], data: string[][], name: string) {
  const prefix = 'a' + randomId(3);

  const rows = header.slice(1),
    cols = data.map((d) => d.shift());

  const dataRange = d3.range(rows.length * cols.length);

  function byIndex(i, v?) {
    const m = i % cols.length;
    if (v !== undefined) {
      return data[(i - m) / cols.length][m] = v;
    } else {
      return data[(i - m) / cols.length][m];
    }
  }

  const editor = await guessValueType(editors, 'value', -1, dataRange, byIndex);
  const configs = [{
    column: -1,
    name: 'Row ID Type',
    value: {
      type: 'idType'
    },
    editor: editors.filter((e) => e.id === 'idType')[0]
  }, {
    column: -1,
    name: 'Column ID Type',
    value: {
      type: 'idType'
    },
    editor: editors.filter((e) => e.id === 'idType')[0]
  }, {
    column: -1,
    name: 'value',
    value: {
      type: null
    },
    editor
  }];

  const $rows = $root.html(commonFields(name)).selectAll('div.field').data(configs);
  $rows.enter().append('div').classed('form-group', true).html((d, i) => `
        <label for="${prefix}_${i}">${d.name}</label>
        <div class="input-group">
          <select class="form-control" ${i < 2 ? 'disabled="disabled"' : ''} id="${prefix}_${i}">
            ${editors.map((editor) => `<option value="${editor.id}" ${d.value.type === editor.id ? 'selected="selected"' : ''}>${editor.name}</option>`).join('\n')}
          </select>
          <span class="input-group-btn"><button class="btn btn-secondary" ${!d.editor.hasEditor ? 'disabled="disabled' : ''} type="button"><i class="glyphicon glyphicon-cog"></i></button></span>
        </div>`);

  $rows.select('select').on('change', updateType(editors, false));
  $rows.select('button').on('click', (d, i) => {
    if (i < 2) {
      d.editor.guessOptions(d.value, i === 0 ? rows : cols, identity);
    } else {
      d.editor.guessOptions(d.value, dataRange, byIndex);
    }
    d.editor.edit(d.value);
  });

  //parse data
  //TODO set rows and cols
  configs[0].editor.parse(configs[0].value, rows, identity);
  configs[1].editor.parse(configs[1].value, cols, identity);
  configs[2].editor.parse(configs[2].value, dataRange, byIndex);


  const common = extractCommonFields($root);

  const desc: IDataDescription = {
    type: 'matrix',
    id: fixId(common.name + randomId(3)),
    name: common.name,
    fqname: 'upload/' + common.name,
    creator: getCurrentUser(),
    ts: Date.now(),
    description: common.description,
    size: [rows.length, cols.length],
    rowtype: (<any>configs[0]).value.idType,
    coltype: (<any>configs[1]).value.idType,
    value: configs[1].value
  };

  return () => ({rows, cols, data, desc});
}
