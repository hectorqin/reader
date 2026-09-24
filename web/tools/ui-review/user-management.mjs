import assert from 'node:assert/strict';
import { join } from 'node:path';

export async function reviewUserManagement(context,page,base,shots) {
  const button=name=>page.getByRole('button',{name,exact:true});
  await page.getByRole('button',{name:/书架设置/}).click();await button('用户管理').click();
  const dialog=page.getByRole('dialog',{name:'用户管理'});
  await page.getByText('共 1 个账号',{exact:true}).waitFor();
  await button('新增用户').click();await dialog.getByLabel('用户名',{exact:true}).fill('family-ui');await dialog.getByLabel('初始密码').fill('password123');await dialog.getByLabel('显示名',{exact:true}).fill('家人');await button('创建账号').click();
  const member=dialog.locator('li').filter({hasText:'@family-ui'});await member.waitFor();
  await member.getByRole('button',{name:'设为管理员',exact:true}).click();await button('确认操作').click();await member.getByRole('button',{name:'移除管理员',exact:true}).waitFor();
  await member.getByRole('button',{name:'移除管理员',exact:true}).click();await button('确认操作').click();await member.getByRole('button',{name:'设为管理员',exact:true}).waitFor();
  await member.getByRole('button',{name:'停用',exact:true}).click();await button('确认操作').click();await member.getByRole('button',{name:'启用',exact:true}).waitFor();
  await member.getByRole('button',{name:'启用',exact:true}).click();await button('确认操作').click();await member.getByRole('button',{name:'停用',exact:true}).waitFor();
  await member.getByRole('button',{name:'重置密码',exact:true}).click();await dialog.getByLabel('新密码',{exact:true}).fill('password456');await button('确认重置密码').click();await page.getByText('密码已重置，旧会话已失效',{exact:true}).waitFor();
  await page.screenshot({path:join(shots,'admin-users-390.png')});
  await button('注册与邀请').click();await dialog.getByLabel('注册方式').selectOption('invite');await button('确认操作').click();await page.getByText('已保存',{exact:true}).waitFor();
  await page.getByText('创建邀请码',{exact:true}).click();await dialog.getByLabel('备注',{exact:true}).fill('家人注册');await button('生成邀请码').click();await dialog.getByLabel('新邀请码',{exact:true}).waitFor();
  const code=await dialog.getByLabel('新邀请码',{exact:true}).inputValue();assert.ok(code.length>=20);
  await page.screenshot({path:join(shots,'admin-registration-390.png')});
  assert.equal(await dialog.evaluate(el=>el.scrollWidth>el.clientWidth),false);
  const newcomer=await context.browser().newContext({viewport:{width:390,height:844}}), visitor=await newcomer.newPage();
  try {
    await visitor.goto(base);await visitor.getByRole('button',{name:'注册新账号',exact:true}).click();await visitor.getByLabel('邀请码',{exact:true}).waitFor();
    await visitor.getByLabel('用户名',{exact:true}).fill('invited-ui');await visitor.getByLabel('密码',{exact:true}).fill('password123');await visitor.getByLabel('邀请码',{exact:true}).fill(code);
    await visitor.getByRole('button',{name:'注册并登录',exact:true}).click();await visitor.locator('.shelf-screen').waitFor();
    await visitor.getByRole('button',{name:/书架设置/}).click();assert.equal(await visitor.getByRole('button',{name:'用户管理',exact:true}).count(),0);
  } finally {await newcomer.close();}
  await dialog.getByLabel('注册方式').selectOption('closed');await button('确认操作').click();await page.getByText('已保存',{exact:true}).waitFor();
  await button('关闭弹窗').click();await page.getByRole('dialog',{name:'书架设置'}).getByRole('button',{name:'关闭',exact:true}).click();
  const anonymous=await context.browser().newContext(), login=await anonymous.newPage();
  try {await login.goto(base);await login.getByRole('button',{name:'注册新账号',exact:true}).click();await login.getByText('此书房暂未开放注册，请联系管理员创建账号或开放注册。',{exact:true}).waitFor();assert.equal(await login.getByRole('button',{name:'注册并登录',exact:true}).isDisabled(),true);}finally{await anonymous.close();}
}
